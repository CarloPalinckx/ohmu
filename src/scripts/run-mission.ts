/**
 * CLI entry point for running SDK missions.
 *
 * Usage:
 *   npm run mission <mission-name> [--cwd=<path>] [--<param>=<value> ...]
 *
 * Examples:
 *   npm run mission fix-vulnerability --cwd=/path/to/repo --identifier=CVE-2021-44228
 */

import path from 'node:path';
import type { MissionRun, MissionConfig } from '../framework/mission.ts';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse `--key=value` and `--key value` CLI arguments into a plain object.
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
      result[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
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
 * Expects a default export produced by mission().
 *
 * @param name - Mission file name without extension (e.g. 'fix-vulnerability').
 */
async function loadMission(name: string): Promise<MissionRun<MissionConfig>> {
  const missionPath = path.resolve(import.meta.dirname, `../missions/${name}.ts`);
  const mod = await import(missionPath);
  if (typeof mod.default !== 'function' || !mod.default.config) {
    throw new Error(`Mission "${name}" must have a default export produced by mission().`);
  }
  return mod.default as MissionRun<MissionConfig>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , missionName, ...rest] = process.argv;

  if (!missionName || missionName.startsWith('--')) {
    console.error('Usage: npm run mission <mission-name> [--cwd=<path>] [--<param>=<value> ...]');
    process.exit(1);
  }

  const args = parseArgs(rest);
  const { cwd: rawCwd, ...rawParams } = args;
  const cwd = rawCwd ? path.resolve(rawCwd) : process.cwd();

  const run = await loadMission(missionName);
  const params = run.config.parameters.parse(rawParams);

  console.log(`[mission] ${missionName}`);
  console.log(`[mission] cwd: ${cwd}`);
  console.log(`[mission] params: ${JSON.stringify(params)}`);

  const ac = new AbortController();
  const onSignal = (sig: string) => {
    console.error(`\n[mission] ${sig} received — aborting current turn, verify will still run`);
    ac.abort();
  };
  process.once('SIGTERM', () => {
    return onSignal('SIGTERM');
  });
  process.once('SIGINT', () => {
    return onSignal('SIGINT');
  });

  try {
    await run(params, cwd, ac.signal);
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }

  console.log(`[mission] done`);
}

main().catch((err) => {
  console.error('[mission] fatal:', err);
  process.exit(1);
});
