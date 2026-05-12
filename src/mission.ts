import fs from "node:fs/promises";
import nodePath from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";

const execAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Base parameters — required by every mission
// ---------------------------------------------------------------------------

/**
 * Zod schema for the parameters that every mission must supply,
 * regardless of mission type. Merged with mission-specific parameters
 * in `assembleMission`.
 */
export const baseParameters = z.object({
  repo: z.string().describe("GitHub repository to work in (owner/name, e.g. acme/my-app)"),
});

// ---------------------------------------------------------------------------
// VerificationResponse + helper
// ---------------------------------------------------------------------------

/**
 * The return type of a `verify()` method. Currently a plain string prompt,
 * but typed separately so it can evolve without touching every subclass.
 */
export type VerificationResponse = string;

/**
 * Wrap verification instructions in a `VerificationResponse`.
 * Appends a structured VERDICT directive so the runner can parse pass/fail
 * from the agent's output and decide whether to retry `execute()`.
 *
 * @param instructions - The verification prompt to send to the agent.
 */
export function verify(instructions: string): VerificationResponse {
  return `When every check below passes, output VERDICT: PASS on its own line.
If any check fails, output VERDICT: FAIL followed by a concise explanation.
Output the VERDICT line as the very last thing you write — do not stop without it.

${instructions}`;
}

// ---------------------------------------------------------------------------
// MissionConfig — static descriptor attached to each Mission subclass
// ---------------------------------------------------------------------------

export interface MissionConfig {
  /** Matches the `mission:` field in issue frontmatter (e.g. "vuln-fix"). */
  name: string;
  /** One-line description shown in logs. */
  description: string;
  /** Skill names or paths made available for every phase of this mission. */
  skills?: string[];
  /** Zod schema describing the issue-frontmatter variables this mission requires. */
  parameters?: z.AnyZodObject;
}

// ---------------------------------------------------------------------------
// MissionRun — the assembled, ready-to-execute unit of work
// ---------------------------------------------------------------------------

export interface MissionRun {
  /** Short label for logging. */
  label: string;

  /** GitHub repository this mission operates on (owner/name). */
  repo: string;

  /**
   * Lifecycle phase run before the main instructions.
   * Use this to set up the environment, install dependencies,
   * validate preconditions, etc.
   */
  prepare?: string;

  /** Full instructions the agent will receive as its goal. */
  instructions: string;

  /**
   * Lifecycle phase run after the main instructions.
   * Use this to assert outcomes, run tests, or confirm the work
   * meets acceptance criteria.
   */
  verify?: string;

  /**
   * Called after every lifecycle phase with that phase's transcript.
   * Returns the prompt to send to the retrospect agent, or `undefined` to skip.
   */
  retrospect?: (transcript: string) => string | undefined;

  /**
   * Skills to make available during every lifecycle phase of this mission.
   * Each entry is a skill name (auto-discovered) or a path to a skill
   * directory. When omitted, all auto-discovered skills are available.
   */
  skills?: string[];
}

// ---------------------------------------------------------------------------
// Mission — base class, subclassed in src/missions/<name>.ts
// ---------------------------------------------------------------------------

/**
 * Type alias for a Mission subclass constructor (with its static `config`).
 */
export type MissionConstructor = (new (params: Record<string, unknown>) => Mission) & {
  config: MissionConfig;
};

/**
 * Base class for all mission types.
 *
 * Create a subclass in `src/missions/<name>.ts` and export it as the default
 * export — it will be auto-discovered and instantiated at runtime with no
 * manual registration required.
 *
 * Define a `static config` object on your subclass — its `name` must match
 * the `mission:` field in the issue frontmatter.
 *
 * @example
 * export default class MyMission extends Mission {
 *   static config = {
 *     name: 'my-mission',
 *     description: 'Does something useful.',
 *     skills: [],
 *     parameters: z.object({ foo: z.string() }),
 *   };
 *
 *   execute() { return `Do something with ${this.parameters.foo}`; }
 * }
 */
export abstract class Mission {
  /**
   * Static descriptor for this mission type.
   * Subclasses must define this with at minimum `name` and `description`.
   */
  static config: MissionConfig;

  /**
   * Parsed issue-frontmatter parameters for this mission instance.
   * Typed as `Record<string, unknown>`; actual shape is determined by
   * `static config.parameters` (a Zod schema) on the subclass.
   */
  protected readonly parameters: Record<string, unknown>;

  constructor(params: Record<string, unknown>) {
    this.parameters = params;
  }

  /**
   * Short label used in logs.
   * Defaults to the subclass's `config.name`.
   */
  label(): string {
    return (this.constructor as typeof Mission).config?.name ?? 'unknown';
  }

  /**
   * Run before the main phase: install deps, validate preconditions, etc.
   * Return `undefined` to skip this phase (default).
   */
  prepare(): string | undefined {
    return undefined;
  }

  /** The main agent instructions for this mission. */
  abstract execute(): string;

  /**
   * Run after the main phase: assert outcomes, run tests, confirm criteria.
   * Return `undefined` to skip this phase (default).
   */
  verify(): VerificationResponse | undefined {
    return undefined;
  }

  /**
   * Run after every lifecycle phase (prepare, execute, verify).
   * Receives the full transcript of the phase that just completed so the
   * agent can ground its reflection in what actually happened.
   * Return `undefined` to skip this phase (default).
   *
   * @param transcript - Full text output captured from the preceding phase.
   */
  retrospect(transcript: string): string | undefined {
    return `You have just completed a phase. Here is the transcript:

<transcript>
${transcript}
</transcript>

Review the transcript and identify any steps that took more effort than necessary.
Append a short entry to a file called OHMU_RETROSPECTIVE.md in the current directory using this format:

---
## <short title describing what happened>

**What took extra effort:** <describe the inefficiency>
**How to improve:** <concrete suggestion for future runs>
---

If the transcript shows no meaningful inefficiency, skip writing the file.`;
  }
}

/**
 * Instantiate a Mission subclass with the given params and assemble a `MissionRun`.
 *
 * When the subclass declares `config.parameters` (a Zod schema), the raw params
 * are parsed through it before the instance is constructed. This validates required
 * fields and strips unknown keys, throwing a `ZodError` on failure.
 */
export function assembleMission(Cls: MissionConstructor, params: Record<string, string>): MissionRun {
  const { repo } = baseParameters.parse(params);
  const schema = Cls.config?.parameters;
  const validated = schema ? schema.parse(params) : params;
  const mission = new Cls(validated);
  return {
    repo,
    label:        mission.label(),
    prepare:      mission.prepare(),
    instructions: mission.execute(),
    verify:       mission.verify(),
    retrospect:   (transcript) => mission.retrospect(transcript),
    skills:       Cls.config?.skills,
  };
}

// ---------------------------------------------------------------------------
// Auto-loader — discovers all Mission subclasses from src/missions/
// ---------------------------------------------------------------------------

function isMissionClass(value: unknown): value is MissionConstructor {
  return (
    typeof value === "function" &&
    value.prototype instanceof Mission &&
    "config" in value
  );
}

let missionCache: MissionConstructor[] | undefined;

/** Load (and cache) every Mission subclass exported from src/missions/. */
export async function loadMissions(): Promise<MissionConstructor[]> {
  if (missionCache) return missionCache;

  const missionsDir = nodePath.join(
    nodePath.dirname(new URL(import.meta.url).pathname),
    "missions",
  );

  let files: string[];
  try {
    files = await fs.readdir(missionsDir);
  } catch {
    // No missions folder yet — return empty.
    return (missionCache = []);
  }

  const definitions: MissionConstructor[] = [];

  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;

    const mod: Record<string, unknown> = await import(
      pathToFileURL(nodePath.join(missionsDir, file)).href
    );

    // Prefer the default export; fall back to any named export that matches.
    const candidates = [mod["default"], ...Object.values(mod)];
    for (const candidate of candidates) {
      if (isMissionClass(candidate)) {
        definitions.push(candidate);
        break;
      }
    }
  }

  return (missionCache = definitions);
}

/** Find a Mission subclass constructor by its `config.name` field. */
export async function findMission(name: string): Promise<MissionConstructor | undefined> {
  const definitions = await loadMissions();
  return definitions.find((Cls) => Cls.config?.name === name);
}

// ---------------------------------------------------------------------------
// Mission runner
// ---------------------------------------------------------------------------

type Phase = "prepare" | "run" | "verify" | "retrospect";

/** Parsed result from a verify-phase agent run. */
interface VerifyResult {
  passed: boolean;
  /** Present when `passed` is false; contains the agent's explanation. */
  feedback?: string;
}

/**
 * Parse a `VERDICT: PASS` or `VERDICT: FAIL` line from agent output.
 * Defaults to passed when no verdict is found to avoid false blocks.
 *
 * @param output - Full text output captured from the verify phase.
 */
function parseVerifyResult(output: string): VerifyResult {
  const failMatch = output.match(/VERDICT:\s*FAIL[:\s]+([\s\S]*)/i);
  if (failMatch) return { passed: false, feedback: failMatch[1].trim() };
  return { passed: true };
}

/**
 * Spawn an isolated agent session for a single lifecycle phase.
 *
 * Every call creates a completely fresh session — new AuthStorage, ResourceLoader,
 * ModelRegistry, and an in-memory SessionManager with no prior conversation history.
 * Phases share only the filesystem (cwd), which is intentional: prepare stages
 * the environment for execute, and execute's output is what verify inspects.
 *
 * @param phase        - Label used for logging.
 * @param instructions - The full prompt the agent receives as its goal.
 * @param cwd          - Working directory the agent operates in.
 * @param skills       - Skill names / paths to make available, or undefined for all.
 * @returns            The full text output produced by the agent.
 */
async function spawnPhase(
  phase: Phase,
  instructions: string,
  cwd: string,
  skills: string[] | undefined,
): Promise<string> {
  const authStorage = AuthStorage.create();
  const agentDir = getAgentDir();

  // `skillsOverride` must be synchronous per the SDK contract, so we
  // pre-resolve any path-based skills (which require async file reads)
  // before constructing the loader. Named skills are resolved synchronously
  // inside the override from the loader's own discovered set.
  const preResolvedPathSkills = skills !== undefined
    ? await resolvePathSkills(skills)
    : undefined;

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    ...(skills !== undefined && {
      skillsOverride: (current) => ({
        skills: resolveNamedSkills(skills, current.skills, preResolvedPathSkills!),
        diagnostics: current.diagnostics,
      }),
    }),
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry: ModelRegistry.create(authStorage),
  });

  let output = "";

  const unsub = session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
      output += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(instructions);
  } finally {
    unsub();
    session.dispose();
  }

  return output;
}

/** Maximum number of execute→verify cycles before giving up. */
const MAX_EXECUTE_RETRIES = 3;

/**
 * Clone `repo` into `workspacesDir/<repo-slug>` if the directory is absent,
 * then add a new git worktree at `workspacesDir/<repo-slug>-<branch-slug>`
 * on a fresh branch named `ohmu/<branch-slug>`.
 *
 * The branch slug is derived from the mission label and a millisecond
 * timestamp to guarantee uniqueness across repeated runs.
 *
 * @param ohmCwd  - The ohmu project root (must contain a `workspaces/` dir).
 * @param repo    - GitHub repo in `owner/name` format.
 * @param label   - Human-readable mission label used to name the branch.
 * @returns         Absolute path to the newly created worktree checkout.
 */
async function setupWorktree(ohmCwd: string, repo: string, label: string): Promise<string> {
  const workspacesDir = nodePath.join(ohmCwd, "workspaces");
  const repoSlug = repo.split("/").at(-1) ?? repo.replace(/\//g, "-");
  const repoDir = nodePath.join(workspacesDir, repoSlug);

  // Clone if the directory is absent.
  try {
    await fs.access(repoDir);
  } catch {
    console.log(`[ohmu] cloning ${repo} → ${repoDir}`);
    await execAsync("gh", ["repo", "clone", repo, repoDir]);
  }

  // Derive a URL-safe slug from the mission label + timestamp for uniqueness.
  const labelSlug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const branchSlug = `${labelSlug}-${Date.now()}`;
  const branch = `ohmu/${branchSlug}`;
  const worktreeDir = nodePath.join(workspacesDir, `${repoSlug}-${branchSlug}`);

  console.log(`[ohmu] creating worktree on branch '${branch}' → ${worktreeDir}`);
  await execAsync("git", ["-C", repoDir, "worktree", "add", worktreeDir, "-b", branch]);

  return worktreeDir;
}

export async function runMission(mission: MissionRun, ohmCwd: string): Promise<void> {
  const cwd = await setupWorktree(ohmCwd, mission.repo, mission.label);
  console.log(`[ohmu] mission: ${mission.label}`);

  if (mission.skills !== undefined) {
    console.log(
      `[ohmu] [${mission.label}] skills: ${mission.skills.length ? mission.skills.join(", ") : "(none)"}`,
    );
  }

  if (mission.prepare) {
    console.log(`[ohmu] [${mission.label}] phase: prepare`);
    const prepareTranscript = await spawnPhase("prepare", mission.prepare, cwd, mission.skills);
    console.log(`[ohmu] [${mission.label}] phase: prepare — done`);
    if (mission.retrospect) {
      const prompt = mission.retrospect(prepareTranscript);
      if (prompt) await spawnPhase("retrospect", prompt, cwd, mission.skills);
    }
  }

  // Execute → verify loop. On a failed verify the feedback is prepended to
  // the execute instructions and the cycle repeats up to MAX_EXECUTE_RETRIES.
  let feedback: string | undefined;

  for (let attempt = 1; attempt <= MAX_EXECUTE_RETRIES; attempt++) {
    const executePrompt = feedback
      ? `The previous attempt was rejected during verification. Address the following feedback before proceeding:\n\n${feedback}\n\n---\n\n${mission.instructions}`
      : mission.instructions;

    console.log(`[ohmu] [${mission.label}] phase: execute (attempt ${attempt}/${MAX_EXECUTE_RETRIES})`);
    const executeTranscript = await spawnPhase("run", executePrompt, cwd, mission.skills);
    console.log(`[ohmu] [${mission.label}] phase: execute — done`);

    if (mission.retrospect) {
      const prompt = mission.retrospect(executeTranscript);
      if (prompt) await spawnPhase("retrospect", prompt, cwd, mission.skills);
    }

    if (!mission.verify) break;

    console.log(`[ohmu] [${mission.label}] phase: verify`);
    const verifyOutput = await spawnPhase("verify", mission.verify, cwd, mission.skills);
    console.log(`[ohmu] [${mission.label}] phase: verify — done`);

    if (mission.retrospect) {
      const prompt = mission.retrospect(verifyOutput);
      if (prompt) await spawnPhase("retrospect", prompt, cwd, mission.skills);
    }

    const result = parseVerifyResult(verifyOutput);

    if (result.passed) {
      console.log(`[ohmu] [${mission.label}] verify: PASS`);
      break;
    }

    console.log(`[ohmu] [${mission.label}] verify: FAIL — ${result.feedback ?? "no details provided"}`);

    if (attempt >= MAX_EXECUTE_RETRIES) {
      console.error(`[ohmu] [${mission.label}] max retries (${MAX_EXECUTE_RETRIES}) reached without a passing verify.`);
      if (mission.retrospect) {
        const exhaustedPrompt = `The mission "${mission.label}" failed to pass verification after ${MAX_EXECUTE_RETRIES} attempts.

Final verification transcript:

<transcript>
${verifyOutput}
</transcript>

Use the /write-retrospective skill to document:
1. Why the execute→verify loop stalled.
2. Concrete improvements to the execute or verify instructions to prevent this in future runs.`;
        await spawnPhase("retrospect", exhaustedPrompt, cwd, mission.skills);
      }
      break;
    }

    feedback = result.feedback;
  }
}

// ---------------------------------------------------------------------------
// Skill resolution (used by spawnPhase)
// ---------------------------------------------------------------------------

function isSkillPath(s: string): boolean {
  return s.startsWith("/") || s.startsWith("./") || s.startsWith("../");
}

async function parseSkillFrontmatter(
  skillMdPath: string,
): Promise<{ name: string; description: string } | null> {
  try {
    const content = await fs.readFile(skillMdPath, "utf-8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fm = match[1];
    const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (!name || !description) return null;
    return { name, description };
  } catch {
    return null;
  }
}

/**
 * Async step: load Skill metadata for every path-based entry in `skills`.
 * Named entries (no path prefix) are skipped — they are resolved later in
 * `resolveNamedSkills` where the loader's discovered set is available.
 *
 * @param skills - Mixed list of skill names and/or filesystem paths.
 * @returns       Fully hydrated `Skill` objects for path-based entries only.
 */
async function resolvePathSkills(skills: string[]): Promise<Skill[]> {
  const result: Skill[] = [];
  for (const entry of skills) {
    if (!isSkillPath(entry)) continue;
    const skillMdPath = nodePath.join(entry, "SKILL.md");
    const parsed = await parseSkillFrontmatter(skillMdPath);
    if (parsed) {
      result.push({
        name: parsed.name,
        description: parsed.description,
        filePath: nodePath.resolve(skillMdPath),
        baseDir: nodePath.resolve(entry),
        source: "custom",
      });
    } else {
      console.warn(`[ohmu] could not load skill from path: ${entry}`);
    }
  }
  return result;
}

/**
 * Sync step: resolve named entries against the loader's discovered skills and
 * merge with the already-resolved path-based skills.
 * Called inside `skillsOverride`, which must be synchronous per the SDK contract.
 *
 * @param skills              - Original mixed list of skill names / paths.
 * @param discovered          - Skills discovered by the loader from the cwd.
 * @param preResolvedPathSkills - Skills already loaded by `resolvePathSkills`.
 * @returns                     Final merged skill list for this session.
 */
function resolveNamedSkills(
  skills: string[],
  discovered: Skill[],
  preResolvedPathSkills: Skill[],
): Skill[] {
  const result: Skill[] = [...preResolvedPathSkills];
  for (const entry of skills) {
    if (isSkillPath(entry)) continue; // already handled
    const found = discovered.find((sk) => sk.name === entry);
    if (found) {
      result.push(found);
    } else {
      console.warn(
        `[ohmu] skill not found: "${entry}" — available: ${discovered.map((s) => s.name).join(", ") || "(none)"}`,
      );
    }
  }
  return result;
}
