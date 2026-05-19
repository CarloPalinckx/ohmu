import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionAPI,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  isToolCallEventType,
} from '@earendil-works/pi-coding-agent';
import {
  resolveEscalation,
  subscribeEscalation,
  type EscalationConfig,
  type ResolvedEscalation,
} from './escalation.ts';
import { createWorktree, type WorktreeConfig, type WorktreeHandle } from './worktree.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  maxRetries?: number;
}

export type { EscalationConfig };

export interface MissionSession {
  prompt(text: string): Promise<void>;
  verify(verifyText: string, opts?: VerifyOptions): Promise<void>;
  dispose(): Promise<void>;
  getSessionFile(): string | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an AgentSessionRuntime backed by a persistent session file in cwd.
 * The runtime is required (over a plain AgentSession) to support runtime.fork().
 *
 * @param cwd - Working directory for the agent and session storage.
 * @param signal - Optional abort signal. When fired, the current agent turn is aborted.
 */
const SYSTEM_PROMPT = `
**IMPORTANT**
- DO NOT use \`grep\`. Use \`ag\` instead — it's faster and respects .gitignore.
- DO NOT use \`find\`. Use \`fd\` instead — it's faster and respects .gitignore.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Preferences
- Add docbloc to the functions you write.
`;

/**
 * Enforce ag/fd over grep/find.
 * Blocks bash tool calls using grep or find, forcing the agent to use ag and fd instead.
 */
function enforceSearchTools(pi: ExtensionAPI) {
  pi.on('tool_call', async (event, _ctx) => {
    // Block the native grep/find tools directly.
    if (isToolCallEventType('grep', event)) {
      return { block: true, reason: '`grep` is not allowed — use `ag <pattern> [path]` instead' };
    }
    if (isToolCallEventType('find', event)) {
      return { block: true, reason: '`find` is not allowed — use `fd <pattern> [path]` instead' };
    }

    // Also block grep/find when invoked as shell commands inside bash.
    if (!isToolCallEventType('bash', event)) return;

    const cmd = event.input.command;
    const usesGrep = /\bgrep\b/.test(cmd);
    const usesFind = /\bfind\b/.test(cmd);

    if (!usesGrep && !usesFind) return;

    const reasons: string[] = [];
    if (usesGrep) reasons.push('`grep` is not allowed — use `ag <pattern> [path]` instead');
    if (usesFind) reasons.push('`find` is not allowed — use `fd <pattern> [path]` instead');

    return { block: true, reason: reasons.join('; ') };
  });
}

async function buildRuntime(cwd: string, signal?: AbortSignal): Promise<AgentSessionRuntime> {
  const factory: CreateAgentSessionRuntimeFactory = async ({
    cwd: effectiveCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: effectiveCwd,
      agentDir: getAgentDir(),
      resourceLoaderOptions: {
        systemPromptOverride: () => {return SYSTEM_PROMPT},
        extensionFactories: [enforceSearchTools],
      },
    });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(factory, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(cwd),
  });

  signal?.addEventListener('abort', () => {
    void runtime.session.abort();
  });

  return runtime;
}

/**
 * Subscribe to the runtime's current session and stream assistant text to stdout.
 * Also outputs diagnostic info about what Pi is doing internally.
 * Must be re-called after runtime.fork() since fork replaces runtime.session.
 *
 * @param runtime - The active agent session runtime.
 * @param verbose - If true, show all diagnostic events. If false, show only major events.
 * @param captureText - Optional callback to capture text deltas (for verification).
 * @returns Unsubscribe function.
 */
function streamStdout(
  runtime: AgentSessionRuntime,
  verbose = true,
  captureText?: (text: string) => void,
): () => void {
  return runtime.session.subscribe((event) => {
    switch (event.type) {
      case 'message_update': {
        const evt = event.assistantMessageEvent;
        if (evt.type === 'text_delta') {
          process.stdout.write(evt.delta);
          captureText?.(evt.delta);
        } else if (evt.type === 'text_start' && verbose) {
          process.stderr.write('\n[pi] generating response...\n');
        } else if (evt.type === 'thinking_start' && verbose) {
          process.stderr.write('[pi] thinking...\n');
        } else if (evt.type === 'toolcall_start' && verbose) {
          process.stderr.write(`[pi] calling tool: ${evt.contentIndex}\n`);
        }
        break;
      }

      case 'tool_execution_start': {
        const args = JSON.stringify(event.args).substring(0, 80);
        process.stderr.write(
          `[pi] → executing ${event.toolName}(${args}${JSON.stringify(event.args).length > 80 ? '...' : ''})\n`,
        );
        break;
      }

      case 'tool_execution_update': {
        if (verbose && event.partialResult?.content?.[0]?.type === 'text') {
          const preview = event.partialResult.content[0].text.substring(0, 40);
          process.stderr.write(`[pi]   (output: ${preview}...)\n`);
        }
        break;
      }

      case 'tool_execution_end': {
        if (event.isError) {
          process.stderr.write(`[pi] ✗ ${event.toolName} failed\n`);
        } else {
          process.stderr.write(`[pi] ✓ ${event.toolName} done\n`);
        }
        break;
      }

      case 'turn_start': {
        if (verbose) {
          process.stderr.write(`[pi] turn start\n`);
        }
        break;
      }

      case 'turn_end': {
        if (verbose) {
          process.stderr.write(`[pi] turn complete\n`);
        }
        break;
      }

      case 'compaction_start': {
        process.stderr.write(`[pi] compacting context (${event.reason})...\n`);
        break;
      }

      case 'compaction_end': {
        if (event.result) {
          process.stderr.write(
            `[pi] compaction done: ${event.result.tokensBefore} → ${event.result.tokensBefore - event.result.summary.length} tokens\n`,
          );
        } else if (event.aborted) {
          process.stderr.write(`[pi] compaction aborted\n`);
        } else {
          process.stderr.write(`[pi] compaction failed\n`);
        }
        break;
      }

      case 'auto_retry_start': {
        process.stderr.write(
          `[pi] retrying (attempt ${event.attempt}/${event.maxAttempts}, delay ${event.delayMs}ms)...\n`,
        );
        break;
      }

      case 'auto_retry_end': {
        if (event.success) {
          process.stderr.write(`[pi] retry succeeded\n`);
        } else {
          process.stderr.write(`[pi] retry failed after ${event.attempt} attempts\n`);
        }
        break;
      }

      case 'agent_start': {
        if (verbose) {
          process.stderr.write(`[pi] agent starting...\n`);
        }
        break;
      }

      case 'agent_end': {
        if (verbose) {
          process.stderr.write(`[pi] agent done\n`);
        }
        break;
      }
    }
  });
}

/**
 * Return the ID of the current leaf entry in the runtime's session file.
 * Returns undefined for a brand-new session with no entries yet.
 *
 * @param runtime - The active agent session runtime.
 */
function getCheckpointId(runtime: AgentSessionRuntime): string | undefined {
  const file = runtime.session.sessionFile;
  if (!file) return undefined;
  return SessionManager.open(file).getLeafEntry()?.id;
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

/**
 * Create a mission session — a thin wrapper around AgentSessionRuntime that
 * exposes prompt() and verify() as a simple, flat API.
 *
 * prompt() runs the agent and captures a checkpoint before each call so that
 * a subsequent verify() can fork back on failure. verify() runs a verification
 * prompt, and on VERDICT: FAIL forks the session back to the pre-prompt
 * checkpoint, injects the verifier's feedback into a retry prompt, and retries
 * on a clean branch. Each failed attempt is preserved in the session tree.
 *
 * When signal is aborted mid-prompt, the current agent turn is cancelled and
 * prompt() resolves cleanly (rather than throwing) so the mission body can
 * still reach its verify() call.
 *
 * If worktreeConfig is provided, an isolated git worktree is created and used
 * as the working directory for the agent. The worktree is automatically cleaned
 * up when the session is disposed.
 *
 * @param cwd               - Working directory for the agent and session storage.
 * @param signal            - Optional abort signal for graceful shutdown.
 * @param escalation        - Optional model escalation config. Defaults to haiku → sonnet.
 * @param worktreeConfig    - Optional git worktree config for isolated execution.
 * @param verbose           - If true (default), show all diagnostic events. If false, show only major events.
 */
export async function createSession(
  cwd: string,
  signal?: AbortSignal,
  escalation?: EscalationConfig,
  worktreeConfig?: WorktreeConfig,
  verbose = true,
): Promise<MissionSession> {
  const resolved: ResolvedEscalation = resolveEscalation(escalation);

  // Create a worktree if requested.
  let worktreeHandle: WorktreeHandle | undefined;
  let effectiveCwd = cwd;
  if (worktreeConfig) {
    worktreeHandle = await createWorktree(cwd, worktreeConfig);
    effectiveCwd = worktreeHandle.path;
  }

  const runtime = await buildRuntime(effectiveCwd, signal);

  // Start every session on the first (cheapest) model.
  await runtime.session.setModel(resolved.models[0].model);

  // Shared mutable state between prompt() and verify().
  // prompt() writes these before returning; verify() reads them.
  let lastPromptText = '';
  let checkpointId: string | undefined;

  return {
    /**
     * Run a prompt against the agent. Captures a checkpoint so that a
     * subsequent verify() call can fork back here on failure.
     *
     * @param text - The prompt to send to the agent.
     */
    async prompt(text: string): Promise<void> {
      // Reset to the first model and clear stuck state before each fresh attempt.
      await runtime.session.setModel(resolved.models[0].model);
      checkpointId = getCheckpointId(runtime);
      lastPromptText = text;

      const unsubEscalation = subscribeEscalation(runtime.session, resolved);
      const unsub = streamStdout(runtime, verbose);
      try {
        await runtime.session.prompt(text);
      } catch (err) {
        // If the signal fired, swallow the abort error so the mission body
        // continues to its verify() call rather than exiting with an exception.
        if (signal?.aborted) return;
        throw err;
      } finally {
        unsubEscalation();
        unsub();
      }
    },

    /**
     * Run a verification prompt against the output of the last prompt(). On
     * failure, fork the session back to the pre-prompt checkpoint and retry
     * the main prompt on a clean branch. Throws if every attempt fails.
     *
     * Each failed attempt is preserved as a real branch in the session tree
     * and is inspectable in the pi TUI.
     *
     * maxRetries controls the total number of main-prompt executions
     * (initial + retries). Defaults to 3.
     *
     * @param verifyText - Instructions for the verification agent.
     * @param opts       - Optional: maxRetries (default 3).
     */
    async verify(verifyText: string, opts?: VerifyOptions): Promise<void> {
      const maxRetries = opts?.maxRetries ?? 3;
      const verifyInstruction =
        `${verifyText}\n\n` +
        `End your response with exactly one of:\n` +
        `- "VERDICT: PASS"\n` +
        `- "VERDICT: FAIL: <reason>"`;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let verifyOutput = '';
        const unsub = streamStdout(runtime, verbose, (text) => {
          verifyOutput += text;
        });
        try {
          await runtime.session.prompt(verifyInstruction);
        } catch (err) {
          // If this is the last attempt, re-throw so the caller sees a real error.
          if (attempt === maxRetries - 1) throw err;
          // Otherwise treat a thrown prompt as a retryable failure and fall through.
          verifyOutput = `(prompt error: ${err instanceof Error ? err.message : String(err)})`;
        } finally {
          unsub();
        }

        if (verifyOutput.includes('VERDICT: PASS')) {
          return;
        }

        const isFail = /VERDICT:\s*FAIL/i.test(verifyOutput);
        if (!isFail) {
          // No verdict produced at all (empty output or prompt error). Treat as
          // a retryable failure so the retry/fork logic below runs, rather than
          // throwing immediately without giving the agent another chance.
          if (attempt === maxRetries - 1) {
            throw new Error(
              `verifier did not produce a verdict after ${maxRetries} attempt(s) — check the verify prompt or model output`,
            );
          }
          // Fall through to the fork-and-retry path below.
        }

        if (attempt === maxRetries - 1) {
          const match = verifyOutput.match(/VERDICT: FAIL[:\s]+(.+)/s);
          const reason = match?.[1]?.trim() ?? 'no reason given';

          throw new Error(`verification failed after ${maxRetries} attempt(s): ${reason}`);
        }

        if (!checkpointId) {
          throw new Error(`cannot retry — no checkpoint entry to fork from`);
        }

        console.log(
          `\nverification failed (attempt ${attempt + 1}/${maxRetries}), forking and retrying...`,
        );

        await runtime.fork(checkpointId);

        // Re-capture checkpoint from the new forked session before retrying,
        // so a subsequent failure can fork from the correct entry in the new file.
        checkpointId = getCheckpointId(runtime);

        // Fresh attempt on the new fork: start at the first model and allow re-escalation.
        await runtime.session.setModel(resolved.models[0].model);
        const retryEscUnsub = subscribeEscalation(runtime.session, resolved);
        const retryUnsub = streamStdout(runtime, verbose);
        await runtime.session.prompt(
          `${lastPromptText}\n\n` +
            `---\n` +
            `Your previous attempt failed verification with the following feedback:\n\n` +
            `${verifyOutput}\n\n` +
            `Address this feedback in your approach.`,
        );
        retryUnsub();
        retryEscUnsub();
      }
    },

    /** Return the path of the persisted session file, if any. */
    getSessionFile(): string | undefined {
      return runtime.session.sessionFile;
    },

    /** Dispose the underlying runtime and release resources. */
    async dispose(): Promise<void> {
      const file = runtime.session.sessionFile;
      await runtime.dispose();
      if (file) {
        console.log(`[session] saved: ${file}`);
      }
      if (worktreeHandle) {
        await worktreeHandle.cleanup();
        console.log(`[session] worktree cleaned up: ${worktreeHandle.path}`);
      }
    },
  };
}
