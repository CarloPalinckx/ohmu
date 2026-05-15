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

    return withVerdict(`
      Review the work done in this phase:
      1. Look at the git history to see what was changed.
      2. Run linters and confirm they exit with no errors.
      3. Confirm all tests pass.
    `); // reruns phase if verdict is fail, max 3 attempts
  });
});
```

## Phase context

Each phase runs in its own Pi session. Before a phase starts, the framework calls
`sm.buildSessionContext()` on the previous phase's session and injects the resulting
message list into the new session via `session.agent.state.messages`. This gives the
next phase full structured context — tool calls, file reads, assistant reasoning — without
any manual text extraction or string building.

Example of what the `execute` phase agent sees as prior context:

```
[user]: Explore the codebase and write missing tests for the auth module.

[assistant]: I reviewed the vulnerability report and explored the codebase. Here's what I found:

The vulnerability is a SQL injection in `src/auth/login.ts` at line 84...

[toolCall: read] src/auth/login.ts → <file contents>
[toolCall: bash] npx jest src/auth → 3 tests passed

I've written three new tests covering SQL injection patterns — they currently fail, as expected.
```

The first prompt of each phase is sent on top of this context. No prefix string is
prepended; the messages are part of the session's conversation history.

## Verification as a primitive

`withVerdict` takes a prompt string, appends an instruction to output `VERDICT:PASS`
or `VERDICT:FAIL`, executes it against the phase's Pi session, and parses the result
into a boolean.

```ts
// Returns true for VERDICT:PASS, false for VERDICT:FAIL
return withVerdict(`Review the work...`);
```

Internally:

```ts
async function withVerdict(text: string, session: AgentSession): Promise<boolean> {
  let output = '';
  const unsub = session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      output += event.assistantMessageEvent.delta;
    }
  });
  await session.prompt(text + '\nOutput your verdict as VERDICT:PASS or VERDICT:FAIL.');
  unsub();
  return output.includes('VERDICT:PASS');
}
```

If the verdict is `fail`, the framework retries the phase (see below).
Maximum attempts defaults to 3 and is configurable per phase.

## Phase retries via session branching

When a phase fails its verdict the framework uses the SDK's session tree to rewind and
retry — no new session file is created per attempt.

Retry flow:
1. Before calling the phase callback, record `startEntryId = sm.getLeafId()`.
2. The phase callback runs (tool calls, edits, etc.) in the session.
3. The verifier runs and returns `VERDICT:FAIL`.
4. The framework calls `sm.branchWithSummary(startEntryId, verifierOutput)`, rewinding
   the session tree to the phase start and storing the verifier's analysis as a
   `BranchSummaryMessage`.
5. The next attempt begins from `startEntryId` with the verifier's feedback as context.

All attempts for a phase live in **one session file** as tree branches. The `meta.json`
records the branch entry IDs so the log viewer can navigate attempts.

## Mission log

Every mission run is logged to `.logs/missions/{mission-id}/`.

```
.logs/
  missions/
    a3f9c821-4d12-4e77-b9c0-d1e7a02b5f33/
      meta.json
      phase-prepare.jsonl
      phase-execute.jsonl
```

- **`meta.json`** — mission metadata, phase references, durations, verdicts. No output text.
- **`phase-{name}.jsonl`** — raw Pi session file written by Pi's `SessionManager`.
  Contains full tool call history, tool results, and all assistant messages.
  When retries occur, branch points in the tree record each attempt — no separate attempt files.

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
      "sessionFile": "phase-execute.jsonl",
      "startedAt": "2026-05-13T09:14:22Z",
      "completedAt": "2026-05-13T09:18:45Z",
      "durationMs": 263000,
      "attempts": [
        {
          "startEntryId": "a1b2c3d4",
          "branchEntryId": "e5f6g7h8",
          "durationMs": 180000,
          "verdict": "fail"
        },
        {
          "startEntryId": "e5f6g7h8",
          "branchEntryId": null,
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
