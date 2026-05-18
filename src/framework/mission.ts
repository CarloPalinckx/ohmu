import { type z } from 'zod';
import { createSession, type MissionSession, type EscalationConfig } from './session.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MissionConfig<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  parameters: TSchema;
  /** Model escalation settings. Defaults to haiku → sonnet on stuck detection. */
  escalation?: EscalationConfig;
}

export type { EscalationConfig };

export interface MissionContext<TParams> {
  params: TParams;
  session: MissionSession;
  cwd: string;
}

// ---------------------------------------------------------------------------
// mission()
// ---------------------------------------------------------------------------

/**
 * Define a mission. Accepts a config (with Zod parameter schema) and a
 * callback that receives { params, session, cwd }. Returns the standardized
 * (params, cwd) => Promise<void> run function.
 *
 * The session is created and disposed automatically — the callback only
 * needs to call session.prompt() and session.verify().
 *
 * @param config - Mission config carrying the Zod parameter schema.
 * @param fn     - Mission body, receiving typed params, a managed session, and cwd.
 *
 * @example
 * export const config = { parameters: z.object({ name: z.string() }) };
 *
 * export default mission(config, async ({ params, session }) => {
 *   await session.prompt(`Do something with ${params.name}`);
 *   await session.verify(`Confirm it worked.`);
 * });
 */
export type MissionRun<TConfig extends MissionConfig> = ((
  params: z.infer<TConfig['parameters']>,
  cwd: string,
  signal?: AbortSignal,
) => Promise<void>) & { config: TConfig };

export function mission<TConfig extends MissionConfig>(
  config: TConfig,
  fn: (ctx: MissionContext<z.infer<TConfig['parameters']>>) => Promise<void>,
): MissionRun<TConfig> {
  const run = async (params: z.infer<TConfig['parameters']>, cwd: string, signal?: AbortSignal) => {
    const session = await createSession(cwd, signal, config.escalation);
    try {
      await fn({ params, session, cwd });
    } finally {
      await session.dispose();
    }
  };
  run.config = config;
  return run as MissionRun<TConfig>;
}
