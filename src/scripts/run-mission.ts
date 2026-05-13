/**
 * CLI entry point for running a mission by name.
 *
 * Usage:
 *   tsx src/scripts/run-mission.ts <mission-name> [--cwd=<path>] [--logs-dir=<path>] [--<param>=<value> ...]
 *
 * Examples:
 *   tsx src/scripts/run-mission.ts fix-vulnerability --cwd=/path/to/repo --identifier=CWE-639
 *   tsx src/scripts/run-mission.ts write-wiki --about="$(cat session.txt)"
 */

import path from 'node:path';
import { runMission } from '../framework/runner.ts';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse `--key=value` and `--key value` CLI arguments into a plain object.
 * Arguments without `--` prefix are ignored (used for positional args).
 *
 * @param args - Raw process.argv slice (after the script path).
 */
function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;

    const eqIndex = arg.indexOf('=');
    if (eqIndex !== -1) {
      const key = arg.slice(2, eqIndex);
      const value = arg.slice(eqIndex + 1);
      result[key] = value;
    } else {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Mission loader
// ---------------------------------------------------------------------------

/**
 * Dynamically import a mission by name from `src/missions/<name>.ts`.
 *
 * @param name - Mission name (e.g. 'fix-vulnerability').
 */
async function loadMission(name: string) {
  const missionPath = path.resolve(import.meta.dirname, `../missions/${name}.ts`);
  const mod = await import(missionPath);
   
  const definition = mod.default;
  if (!definition || typeof definition.run !== 'function') {
    throw new Error(`Mission "${name}" did not export a valid MissionDefinition.`);
  }
  return definition;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , missionName, ...rest] = process.argv;

  if (!missionName || missionName.startsWith('--')) {
    console.error(
      'Usage: tsx src/scripts/run-mission.ts <mission-name> [--cwd=<path>] [--<param>=<value> ...]',
    );
    process.exit(1);
  }

  const args = parseArgs(rest);

  const cwd = args['cwd'] ? path.resolve(args['cwd']) : process.cwd();
  const logsDir = args['logs-dir']
    ? path.resolve(args['logs-dir'])
    : path.join(process.cwd(), '.logs');

  // Strip framework-level flags from parameters
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cwd: _cwd, 'logs-dir': _logsDir, ...parameters } = args;

  const definition = await loadMission(missionName);

  // Validate parameters against the mission's Zod schema
  const parsed = definition.config.parameters.parse(parameters);

  console.log(`[run-mission] mission: ${missionName}`);
  console.log(`[run-mission] cwd: ${cwd}`);
  console.log(`[run-mission] logs-dir: ${logsDir}`);
  console.log(`[run-mission] parameters: ${JSON.stringify(parsed)}`);

  const missionLogDir = await runMission(definition, parsed, cwd, logsDir);
  console.log(`[run-mission] logs: ${missionLogDir}`);
}

main().catch((err) => {
  console.error('[run-mission] fatal:', err);
  process.exit(1);
});
