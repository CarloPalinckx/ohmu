import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  maxRetries?: number;
}

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
async function buildRuntime(cwd: string, signal?: AbortSignal): Promise<AgentSessionRuntime> {
  const factory: CreateAgentSessionRuntimeFactory = async ({
    cwd: effectiveCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({ cwd: effectiveCwd });
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
 * Must be re-called after runtime.fork() since fork replaces runtime.session.
 *
 * @param runtime - The active agent session runtime.
 * @returns Unsubscribe function.
 */
function streamStdout(runtime: AgentSessionRuntime): () => void {
  return runtime.session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      process.stdout.write(event.assistantMessageEvent.delta);
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
 * @param cwd    - Working directory for the agent and session storage.
 * @param signal - Optional abort signal for graceful shutdown.
 */
export async function createSession(cwd: string, signal?: AbortSignal): Promise<MissionSession> {
  const runtime = await buildRuntime(cwd, signal);

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
      checkpointId = getCheckpointId(runtime);
      lastPromptText = text;
      const unsub = streamStdout(runtime);
      try {
        await runtime.session.prompt(text);
      } catch (err) {
        // If the signal fired, swallow the abort error so the mission body
        // continues to its verify() call rather than exiting with an exception.
        if (signal?.aborted) return;
        throw err;
      } finally {
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
        const unsub = runtime.session.subscribe((event) => {
          if (
            event.type === 'message_update' &&
            event.assistantMessageEvent.type === 'text_delta'
          ) {
            process.stdout.write(event.assistantMessageEvent.delta);
            verifyOutput += event.assistantMessageEvent.delta;
          }
        });
        await runtime.session.prompt(verifyInstruction);
        unsub();

        if (verifyOutput.includes('VERDICT: PASS')) return;

        const isFail = /VERDICT:\s*FAIL/i.test(verifyOutput);
        if (!isFail) {
          throw new Error(
            `verifier did not produce a verdict — check the verify prompt or model output`,
          );
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

        const retryUnsub = streamStdout(runtime);
        await runtime.session.prompt(
          `${lastPromptText}\n\n` +
            `---\n` +
            `Your previous attempt failed verification with the following feedback:\n\n` +
            `${verifyOutput}\n\n` +
            `Address this feedback in your approach.`,
        );
        retryUnsub();
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
    },
  };
}
