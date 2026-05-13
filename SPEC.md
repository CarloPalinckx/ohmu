# AI Agent

Designed as a package. Uses the Pi SDK to run prompts.

## Missions

```ts
// in missions/fix-security-vulnerability.ts

import { mission, phase, withVerdict } from '@src';

const config = {
  name: 'fix-security-vulnerability',
  parameters: z.object({
    report: z.string(),
  }),
  tools: ['read', 'bash', 'edit', 'write', 'commit'],
}

mission(config, ({ parameters }) => {
  const prepare = phase(({ prompt }) => {
    prompt(`
      **IMPORTANT: Do not implement any fixes for the vulnerability yet**.
      1. Read the vulnerability report below
      2. Explore the code, figure out where changes are needed
      3. Check coverage of the relevant module
      4. If coverage is lacking, first write tests

      Report:
      ${parameters.report}
    `);
  });

  const execute = phase(({ prompt }) => {
    prompt(`
      It is your task to fix a security vulnerability in the codebase that has been reported by a scanning tool.
      Follow these steps:

      1. Read the vulnerability report below, it will explain the vulnerability.
      2. Implement a fix for the security vulnerability.

      Report:
      ${parameters.report}
    `);

    return withVerdict(prompt(`
      Review the work done in this phase:
      1. Look at the git history to see what was changed.
      2. Run linters and confirm they exit with no errors.
      3. Confirm all tests pass.
    `)); // reruns phase if verdict is fail, max 3 attempts
  });
});
```

## Phase caching

Each phase runs in its own Pi session. Before a phase starts, the framework reads the
previous phase's `.jsonl` session file and extracts all assistant message text. This text
is prepended to the current phase's prompt, giving the agent full context of what was
done before without sharing a live session.

Example of what gets prepended to the `execute` phase:

```
--- Phase: prepare ---
I reviewed the vulnerability report and explored the codebase. Here's what I found:

The vulnerability is a SQL injection in `src/auth/login.ts` at line 84. The `getUserByEmail`
function builds a raw query using string interpolation:

  const query = `SELECT * FROM users WHERE email = '${email}'`;

The `email` parameter comes directly from the request body with no sanitization.

I checked test coverage for the auth module. `src/auth/login.test.ts` exists but only covers
happy-path login. There are no tests for malformed or malicious inputs. I've written three
new tests covering SQL injection patterns — they currently fail, as expected.
---
```

## Verification as a primitive

`withVerdict` takes a lazy `prompt()` call, appends an instruction to output `VERDICT:PASS`
or `VERDICT:FAIL`, executes the prompt against a Pi session, and parses the result into a
boolean.

```ts
// prompt() returns a LazyPrompt — not dispatched until withVerdict executes it
return withVerdict(prompt(`Review the work...`));
```

Internally:

```ts
async function withVerdict(lazy: LazyPrompt): Promise<boolean> {
  lazy.append('\nOutput your verdict as VERDICT:PASS or VERDICT:FAIL.');
  const result = await lazy.execute(session);
  return result.includes('VERDICT:PASS');
}
```

If the verdict is `fail`, the framework reruns the phase (new Pi session, new attempt).
Maximum attempts defaults to 3 and is configurable per phase.

## Mission log

Every mission run is logged to `.logs/missions/{mission-id}/`.

```
.logs/
  missions/
    a3f9c821-4d12-4e77-b9c0-d1e7a02b5f33/
      meta.json
      phase-prepare.jsonl
      phase-execute-attempt-1.jsonl
      phase-execute-attempt-2.jsonl
```

- **`meta.json`** — mission metadata, phase references, durations, verdicts. No output text.
- **`phase-{name}.jsonl`** / **`phase-{name}-attempt-{n}.jsonl`** — raw Pi session files
  written by Pi's `SessionManager`. Contains full tool call history, tool results, and
  all assistant messages.

The phase cache text is derived at runtime by reading the previous phase's `.jsonl` and
extracting assistant message text. It is not stored separately in `meta.json`.

### meta.json example

```json
{
  "missionId": "a3f9c821-4d12-4e77-b9c0-d1e7a02b5f33",
  "mission": "fix-security-vulnerability",
  "parameters": {
    "report": "CVE-2024-1234: SQL injection in login endpoint."
  },
  "startedAt": "2026-05-13T09:12:00Z",
  "completedAt": "2026-05-13T09:18:45Z",
  "durationMs": 405000,
  "outcome": "success",
  "phases": [
    {
      "name": "prepare",
      "sessionFile": "phase-prepare.jsonl",
      "startedAt": "2026-05-13T09:12:00Z",
      "completedAt": "2026-05-13T09:14:22Z",
      "durationMs": 142000
    },
    {
      "name": "execute",
      "verdict": "pass",
      "startedAt": "2026-05-13T09:14:22Z",
      "completedAt": "2026-05-13T09:18:45Z",
      "durationMs": 263000,
      "attempts": [
        {
          "sessionFile": "phase-execute-attempt-1.jsonl",
          "durationMs": 180000,
          "verdict": "fail"
        },
        {
          "sessionFile": "phase-execute-attempt-2.jsonl",
          "durationMs": 83000,
          "verdict": "pass"
        }
      ]
    }
  ]
}
```

### Outcome vs verdict

- **`outcome`** (mission level): `success` / `error`
- **`verdict`** (phase/attempt level): `pass` / `fail`

## Self learning through retrospection

Mission logs are the foundation for automated retrospection. Because each phase's full
tool call history is preserved in `.jsonl` files and `meta.json` tracks durations, verdicts,
and attempt counts, a retrospection pass can:

- Feed phase session text into a prompt to analyze agent behaviour
- Identify phases that consistently require multiple attempts (prompt improvement candidates)
- Compare attempt durations to spot phases where the agent overcorrects on retries
- Flag missions that `error` repeatedly on the same parameters

The `.logs/` folder lives in the repo so logs accumulate over time and a UI can be built
on top to visualize and query mission history.
