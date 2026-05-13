import { z } from 'zod';
import type { PhaseDefinition } from './phase.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Static configuration for a mission.
 */
export interface MissionConfig<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Unique mission name, used for logging and discovery. */
  name: string;
  /** Zod schema describing the parameters this mission accepts. */
  parameters: TParams;
  /** Tool names made available to every phase in this mission. */
  tools: string[];
}

/**
 * Arguments passed to the mission callback.
 */
export interface MissionContext<TParams> {
  parameters: TParams;
}

/**
 * A fully assembled mission, ready to be executed by the runner.
 */
export interface MissionDefinition<TParams = unknown> {
  config: MissionConfig;
  phases: PhaseDefinition[];
  run: (parameters: TParams) => PhaseDefinition[];
}

// ---------------------------------------------------------------------------
// Phase collector
//
// phase() calls inside the mission callback push to this array.
// mission() sets it up before invoking the callback and reads it after.
// ---------------------------------------------------------------------------

let _currentPhases: PhaseDefinition[] | null = null;

/**
 * Called by phase() to register itself with the active mission.
 * Throws if called outside of a mission() callback.
 */
export function registerPhase(phase: PhaseDefinition): void {
  if (_currentPhases === null) {
    throw new Error('phase() must be called inside a mission() callback.');
  }
  _currentPhases.push(phase);
}

// ---------------------------------------------------------------------------
// mission()
// ---------------------------------------------------------------------------

/**
 * Define a mission — a named, parameterized unit of work composed of phases.
 *
 * The callback is invoked immediately to collect phase definitions.
 * Phases are registered in declaration order via phase() calls inside the callback.
 *
 * @param config   - Mission name, parameter schema, and available tools.
 * @param callback - Defines the phases that make up this mission.
 * @returns          A MissionDefinition ready to be passed to the runner.
 *
 * @example
 * export default mission(config, ({ parameters }) => {
 *   phase(({ prompt }) => { prompt(`...`); });
 * });
 */
export function mission<TSchema extends z.ZodTypeAny>(
  config: MissionConfig<TSchema>,
  callback: (context: MissionContext<z.infer<TSchema>>) => void,
): MissionDefinition<z.infer<TSchema>> {
  return {
    config: config as MissionConfig,
    phases: [],
    run(parameters: z.infer<TSchema>): PhaseDefinition[] {
      _currentPhases = [];
      try {
        callback({ parameters });
        this.phases = _currentPhases;
        return this.phases;
      } finally {
        _currentPhases = null;
      }
    },
  };
}
