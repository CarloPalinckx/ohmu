---
title: Challenge Scoring
tags: [juice-shop, ctf, challenges, scoring, challengeUtils]
created: 2026-05-13
---

# Challenge Scoring

Juice Shop tracks whether users have triggered known vulnerabilities for CTF and training purposes. The scoring system is non-blocking — it records success without interfering with the response.

## Core Pattern: `challengeUtils.solveIf`

```ts
import * as challengeUtils from '../lib/challengeUtils'

// Inside a route handler or middleware:
challengeUtils.solveIf(challenges.vulnerableEndpointChallenge, () => {
  return /* boolean expression — true when the exploit was performed */
})
```

- If the callback returns `true`, the named challenge is marked as solved in the database.
- The request **continues normally** regardless of the outcome. This is intentional — the app is meant to be exploitable.

## Challenge Registry

All challenges are seeded from `data/static/challenges.json`. Each entry has a unique `key` that corresponds to a property on the `challenges` object imported from `lib/datacache.ts`:

```ts
import * as datacache from '../lib/datacache'
const challenges = datacache.challenges
```

## Typical Usage in a Route

```ts
router.get('/:id', (req, res) => {
  const requestedId = req.params.id
  const userId = req.userId

  // Score the challenge if the user accessed someone else's basket
  challengeUtils.solveIf(challenges.accessAnotherBasketChallenge, () => {
    return requestedId !== String(userId)  // crude example
  })

  // Normal response continues either way
  Basket.findByPk(requestedId).then(basket => res.json(basket))
})
```

## How Solve State Is Persisted

`challengeUtils.solveIf` calls `challengeUtils.solve(challenge)` internally, which:

1. Sets `challenge.solved = true` in the in-memory `datacache`.
2. Persists the solve to the SQLite `Challenges` table via Sequelize.
3. Emits a WebSocket notification to the frontend so the UI updates in real time.

## Watch Out For

- The callback passed to `solveIf` is evaluated **synchronously**. Do not pass async functions — they will always return a truthy Promise and mark the challenge solved on every request.
- Challenge objects in `datacache` are shared state. A solve persists for the lifetime of the process (and across restarts because it is written to SQLite).
- If you reset the database (fresh server start with a clean SQLite file), all challenge solves are cleared.

## Related Notes

- [[Architecture Overview]]
- [[Security Vulnerabilities — BOLA]]
