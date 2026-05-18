import { getModel } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelStepConfig {
  /** Anthropic model ID. */
  id: string;
  /**
   * Consecutive identical tool calls (same name + args) on this model before
   * escalating to the next. Default: 4. Not meaningful on the last model
   * in the list (there is nowhere left to escalate to).
   */
  threshold?: number;
}

export interface EscalationConfig {
  /**
   * Ordered ladder of models, cheapest first. Each entry carries its own
   * stuck thresholds. Defaults to haiku → sonnet with threshold 4 each.
   */
  models?: ModelStepConfig[];
}

/** Single resolved step in the escalation ladder. */
export interface ResolvedModelStep {
  model: Model<Api>;
  threshold: number;
}

/** Resolved, concrete form of EscalationConfig used internally. */
export interface ResolvedEscalation {
  models: ResolvedModelStep[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: ModelStepConfig[] = [
  { id: 'claude-haiku-4-5', threshold: 4 },
  { id: 'claude-sonnet-4-5', threshold: 4 },
];

// ---------------------------------------------------------------------------
// resolveEscalation
// ---------------------------------------------------------------------------

/**
 * Resolve an EscalationConfig to a concrete ResolvedEscalation.
 * Throws early if any model ID cannot be found, so callers learn at startup
 * rather than at escalation time.
 *
 * @param config - Optional escalation config. All fields have defaults.
 */
export function resolveEscalation(config: EscalationConfig = {}): ResolvedEscalation {
  const steps = config.models ?? DEFAULT_MODELS;

  if (steps.length < 2) {
    throw new Error(`[escalation] models array must have at least 2 entries`);
  }

  const models = steps.map(({ id, threshold = 4 }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = getModel('anthropic', id as any);
    if (!model) throw new Error(`[escalation] model not found: "${id}"`);
    return { model, threshold };
  });

  return { models };
}

// ---------------------------------------------------------------------------
// subscribeEscalation
// ---------------------------------------------------------------------------

/**
 * Attach stuck-detection to one AgentSession for the lifetime of a single
 * prompt attempt. Monitors tool events and, when a stuck pattern is detected,
 * steps to the next model in the escalation ladder using that model's own
 * thresholds.
 *
 * Escalation triggers when the last `threshold` tool calls on the current model
 * all share the same name and serialised arguments — the agent is looping.
 *
 * After each escalation the window resets to the new model's threshold,
 * so a subsequent stuck pattern can trigger a further step up the ladder.
 * Once the last model in the array is active, no further escalation occurs.
 *
 * Returns an unsubscribe function; call it when the prompt finishes so the
 * listener doesn't outlive the attempt.
 *
 * @param session    - The active AgentSession to monitor.
 * @param escalation - Resolved escalation parameters.
 */
export function subscribeEscalation(
  session: AgentSession,
  escalation: ResolvedEscalation,
): () => void {
  const { models } = escalation;

  // Index of the model currently in use. Always starts at 0 since prompt()
  // resets to models[0] before subscribing.
  let currentIndex = 0;
  const recentKeys: string[] = [];

  const unsub = session.subscribe((event) => {
    const { threshold } = models[currentIndex];

    if (event.type === 'tool_execution_start') {
      const key = `${event.toolName}:${JSON.stringify(event.args)}`;
      recentKeys.push(key);
      if (recentKeys.length > threshold) recentKeys.shift();
    }

    if (event.type === 'tool_execution_end') {
      if (currentIndex >= models.length - 1) return; // already at the top

      const isRepeating =
        recentKeys.length >= threshold && recentKeys.every((k) => {return k === recentKeys[0]});

      if (isRepeating) {
        currentIndex++;
        const nextModel = models[currentIndex];
        console.log(
          `\n[escalation] stuck detected ("${event.toolName}" repeated ${threshold}× with identical args) → switching to ${nextModel.model.name}`,
        );
        void session.setModel(nextModel.model);

        // Reset so a subsequent stuck pattern on the new model can trigger
        // a further step up the ladder.
        recentKeys.length = 0;
      }
    }
  });

  return unsub;
}
