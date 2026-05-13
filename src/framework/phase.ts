import { registerPhase } from './mission.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Sends a prompt to the active Pi session and returns the full assistant
 * text output across all turns.
 */
export type PromptFn = (text: string) => Promise<string>;

/**
 * Sends a prompt with verdict instructions appended. Returns true for
 * VERDICT:PASS, false for VERDICT:FAIL.
 */
export type PromptWithVerdictFn = (text: string) => Promise<boolean>;

/**
 * Arguments passed to the phase callback at runtime.
 */
export interface PhaseCallbackContext {
  prompt: PromptFn;
}

/**
 * Verification function returned by a VerifiedPhaseCallback.
 * Called by the runner after the main phase work completes.
 * Returning false triggers a retry up to maxAttempts.
 */
export type VerificationFn = (promptWithVerdict: PromptWithVerdictFn) => Promise<boolean> | boolean;

/**
 * Phase callback with no verification — does not return anything.
 */
export type PhaseCallback = (context: PhaseCallbackContext) => Promise<void> | void;

/**
 * Phase callback with verification — returns a verification function
 * after completing the main work. The runner calls the verifier and
 * retries the phase if it returns false.
 */
export type VerifiedPhaseCallback = (
  context: PhaseCallbackContext,
) => Promise<VerificationFn> | VerificationFn;

/**
 * Optional configuration for a phase.
 */
export interface PhaseConfig {
  /** Label used in logs and session filenames. Defaults to 'phase-{n}'. */
  name?: string;
  /** Maximum number of attempts before the phase is marked as failed. Defaults to 3. */
  maxAttempts?: number;
}

/**
 * A fully assembled phase definition, stored on the mission and executed by the runner.
 */
export interface PhaseDefinition {
  name: string;
  maxAttempts: number;
  callback: PhaseCallback | VerifiedPhaseCallback;
}

// ---------------------------------------------------------------------------
// phase()
// ---------------------------------------------------------------------------

/**
 * Define a phase within a mission.
 *
 * Must be called inside a mission() callback. Phases are executed in
 * declaration order. Each phase runs in its own Pi session.
 *
 * The callback receives prompt and promptWithVerdict functions bound to
 * the phase's Pi session at runtime. Returning a promptWithVerdict result
 * enables the retry loop — the phase reruns up to maxAttempts times on fail.
 *
 * @param configOrCallback - Optional config object, or the callback directly.
 * @param callback         - Phase implementation (required if config is provided).
 * @returns                  The registered PhaseDefinition.
 *
 * @example
 * // No verification — phase always passes
 * phase(({ prompt }) => {
 *   prompt(`Explore the codebase and write missing tests.`);
 * });
 *
 * @example
 * // With verification — retries up to maxAttempts on fail
 * phase({ name: 'execute', maxAttempts: 5 }, ({ prompt, promptWithVerdict }) => {
 *   prompt(`Implement the fix.`);
 *   return promptWithVerdict(`Verify linters and tests pass.`);
 * });
 *
 * @example
 * // Name as a plain string shorthand
 * phase('execute', ({ prompt }) => {
 *   prompt(`Implement the fix.`);
 * });
 */
export function phase(callback: PhaseCallback): PhaseDefinition;
export function phase(callback: VerifiedPhaseCallback): PhaseDefinition;
export function phase(name: string, callback: PhaseCallback): PhaseDefinition;
export function phase(name: string, callback: VerifiedPhaseCallback): PhaseDefinition;
export function phase(config: PhaseConfig, callback: PhaseCallback): PhaseDefinition;
export function phase(config: PhaseConfig, callback: VerifiedPhaseCallback): PhaseDefinition;
export function phase(
  configOrCallback: PhaseConfig | PhaseCallback | VerifiedPhaseCallback | string,
  callback?: PhaseCallback | VerifiedPhaseCallback,
): PhaseDefinition {
  const config: PhaseConfig =
    typeof configOrCallback === 'function'
      ? {}
      : typeof configOrCallback === 'string'
        ? { name: configOrCallback }
        : configOrCallback;
  const cb = (typeof configOrCallback === 'function' ? configOrCallback : callback) as
    | PhaseCallback
    | VerifiedPhaseCallback;

  const definition: PhaseDefinition = {
    name: config.name ?? '',
    maxAttempts: config.maxAttempts ?? 3,
    callback: cb,
  };

  registerPhase(definition);
  return definition;
}
