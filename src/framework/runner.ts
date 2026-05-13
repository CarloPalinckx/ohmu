import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AuthStorage,
  createAgentSession,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import type { MissionDefinition } from './mission.ts';
import type {
  PhaseDefinition,
  PhaseCallbackContext,
  VerificationFn,
  PromptWithVerdictFn,
} from './phase.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttemptLog {
  sessionFile: string;
  durationMs: number;
  verdict: 'pass' | 'fail';
}

export interface PhaseLog {
  name: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  verdict: 'pass' | 'fail';
  attempts: AttemptLog[];
}

export interface MissionLog {
  missionId: string;
  mission: string;
  parameters: unknown;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: 'success' | 'error';
  phases: PhaseLog[];
}

const VERDICT_INSTRUCTION =
  '\n\nOutput your verdict on the last line as either VERDICT:PASS or VERDICT:FAIL.';

// ---------------------------------------------------------------------------
// Output collection
// ---------------------------------------------------------------------------

/**
 * Subscribe to a Pi session and collect assistant text_delta output.
 * Tracks both a running total and a per-prompt current slice.
 */
function createOutputCollector(session: AgentSession) {
  let totalOutput = '';
  let currentOutput = '';

  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      process.stdout.write(event.assistantMessageEvent.delta);
      totalOutput += event.assistantMessageEvent.delta;
      currentOutput += event.assistantMessageEvent.delta;
    }
  });

  return {
    /** Reset the per-prompt slice before each session.prompt() call. */
    resetCurrent() {
      currentOutput = '';
    },
    /** Output from the most recent prompt() call. */
    getCurrent() {
      return currentOutput;
    },
    /** All assistant output accumulated in this session so far. */
    getTotal() {
      return totalOutput;
    },
    unsubscribe,
  };
}

// ---------------------------------------------------------------------------
// Phase context
// ---------------------------------------------------------------------------

/**
 * Build the prompt and promptWithVerdict functions bound to a Pi session.
 * The cache prefix is injected into the first prompt call only.
 *
 * @param session     - Active Pi session for this phase attempt.
 * @param cachePrefix - Concatenated output from all prior phases.
 * @returns            Phase callback context and a getter for total output.
 */
function createPhaseContext(
  session: AgentSession,
  cachePrefix: string,
): {
  context: PhaseCallbackContext;
  promptWithVerdict: PromptWithVerdictFn;
  getTotal: () => string;
} {
  const collector = createOutputCollector(session);
  let prefixInjected = false;

  const context: PhaseCallbackContext = {
    async prompt(text: string): Promise<string> {
      const fullText = !prefixInjected && cachePrefix ? `${cachePrefix}${text}` : text;
      prefixInjected = true;
      collector.resetCurrent();
      await session.prompt(fullText);
      return collector.getCurrent();
    },
  };

  async function promptWithVerdict(text: string): Promise<boolean> {
    collector.resetCurrent();
    await session.prompt(text + VERDICT_INSTRUCTION);
    return collector.getCurrent().includes('VERDICT:PASS');
  }

  return { context, promptWithVerdict, getTotal: collector.getTotal.bind(collector) };
}

// ---------------------------------------------------------------------------
// Phase cache
// ---------------------------------------------------------------------------

/**
 * Build the cache prefix string from all prior phase outputs.
 * Prepended to the first prompt of the current phase.
 *
 * @param priorOutputs - Name and output text from each completed phase.
 */
function buildCachePrefix(priorOutputs: Array<{ name: string; output: string }>): string {
  if (priorOutputs.length === 0) return '';
  return (
    priorOutputs
      .map(({ name, output }) => {
        return `--- Phase: ${name} ---\n${output}\n---`;
      })
      .join('\n\n') + '\n\n'
  );
}

// ---------------------------------------------------------------------------
// Phase attempt
// ---------------------------------------------------------------------------

/**
 * Run a single attempt of a phase in a fresh Pi session.
 *
 * @param phase           - Phase definition containing the callback.
 * @param cachePrefix     - Prior phase output injected into the first prompt.
 * @param sessionFilePath - Path where Pi writes the session .jsonl file.
 * @param cwd             - Working directory for the Pi session.
 * @returns                 Total assistant output, optional verifier function, and the live session
 *                          (caller must dispose it after the verifier has run).
 */
async function runPhaseAttempt(
  phase: PhaseDefinition,
  cachePrefix: string,
  sessionFilePath: string,
  cwd: string,
): Promise<{
  output: string;
  verifier: VerificationFn | null;
  promptWithVerdict: PromptWithVerdictFn;
  session: AgentSession;
}> {
  await mkdir(path.dirname(sessionFilePath), { recursive: true });

  const authStorage = AuthStorage.create();
  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    authStorage,
    modelRegistry: ModelRegistry.create(authStorage),
    sessionManager: SessionManager.open(sessionFilePath),
  });

  const { context, promptWithVerdict, getTotal } = createPhaseContext(session, cachePrefix);

  const result = await phase.callback(context);
  const verifier = typeof result === 'function' ? (result as VerificationFn) : null;
  return { output: getTotal(), verifier, promptWithVerdict, session };
}

// ---------------------------------------------------------------------------
// Phase runner (with retry loop)
// ---------------------------------------------------------------------------

/**
 * Run a phase, retrying up to maxAttempts on a failed verdict.
 *
 * @param phase         - Phase definition.
 * @param phaseIndex    - Zero-based index used to auto-name unnamed phases.
 * @param cachePrefix   - Prior phase output for context injection.
 * @param missionLogDir - Directory where session .jsonl files are written.
 * @param cwd           - Working directory for Pi sessions.
 * @returns               Total output of the final attempt and phase log data.
 */
async function runPhase(
  phase: PhaseDefinition,
  phaseIndex: number,
  cachePrefix: string,
  missionLogDir: string,
  cwd: string,
): Promise<{ output: string; log: PhaseLog }> {
  const name = phase.name || `phase-${phaseIndex + 1}`;
  const phaseStart = Date.now();
  const attempts: AttemptLog[] = [];
  let lastOutput = '';
  let phaseVerdict: 'pass' | 'fail' = 'pass';

  for (let attempt = 1; attempt <= phase.maxAttempts; attempt++) {
    const sessionFile = path.join(missionLogDir, `phase-${name}-attempt-${attempt}.jsonl`);

    console.log(`[mission] phase: ${name} — attempt ${attempt}/${phase.maxAttempts}`);

    const attemptStart = Date.now();
    const { output, verifier, promptWithVerdict, session } = await runPhaseAttempt(
      phase,
      cachePrefix,
      sessionFile,
      cwd,
    );
    lastOutput = output;

    const verdict =
      verifier === null ? 'pass' : (await verifier(promptWithVerdict)) ? 'pass' : 'fail';
    session.dispose();

    attempts.push({
      sessionFile: path.basename(sessionFile),
      durationMs: Date.now() - attemptStart,
      verdict,
    });

    console.log(`[mission] phase: ${name} — verdict: ${verdict}`);

    if (verdict === 'pass') {
      phaseVerdict = 'pass';
      break;
    }

    if (attempt === phase.maxAttempts) {
      console.error(`[mission] phase: ${name} — max attempts (${phase.maxAttempts}) reached`);
      phaseVerdict = 'fail';
    }
  }

  const log: PhaseLog = {
    name,
    startedAt: new Date(phaseStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - phaseStart,
    verdict: phaseVerdict,
    attempts,
  };

  return { output: lastOutput, log };
}

// ---------------------------------------------------------------------------
// Mission runner
// ---------------------------------------------------------------------------

/**
 * Run a full mission: execute all phases in order, inject phase cache,
 * and write meta.json to the mission log directory.
 *
 * Phases are run sequentially. If a phase fails all its attempts the
 * mission is marked as error and remaining phases are skipped.
 *
 * @param definition - The mission definition produced by mission().
 * @param parameters - Parsed parameters matching the mission's Zod schema.
 * @param cwd        - Working directory for all Pi sessions.
 * @param logsDir    - Root logs directory (e.g. path.join(repoRoot, '.logs')).
 * @returns            Absolute path to the directory containing this mission's logs and session files.
 */
export async function runMission<TParams>(
  definition: MissionDefinition<TParams>,
  parameters: TParams,
  cwd: string,
  logsDir: string,
): Promise<string> {
  const missionId = crypto.randomUUID();
  const missionLogDir = path.join(logsDir, 'missions', missionId);
  await mkdir(missionLogDir, { recursive: true });

  console.log(`[mission] ${definition.config.name} — id: ${missionId}`);

  const phases = definition.run(parameters);
  const missionStart = Date.now();
  const phaseLogs: PhaseLog[] = [];
  const priorOutputs: Array<{ name: string; output: string }> = [];
  let outcome: 'success' | 'error' = 'success';

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const cachePrefix = buildCachePrefix(priorOutputs);

    const { output, log } = await runPhase(phase, i, cachePrefix, missionLogDir, cwd);
    phaseLogs.push(log);

    const phaseName = phase.name || `phase-${i + 1}`;
    priorOutputs.push({ name: phaseName, output });

    if (log.verdict === 'fail') {
      outcome = 'error';
      break;
    }
  }

  const metaLog: MissionLog = {
    missionId,
    mission: definition.config.name,
    parameters,
    startedAt: new Date(missionStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - missionStart,
    outcome,
    phases: phaseLogs,
  };

  await writeFile(path.join(missionLogDir, 'meta.json'), JSON.stringify(metaLog, null, 2));

  console.log(`[mission] ${definition.config.name} — outcome: ${outcome}`);
  return missionLogDir;
}
