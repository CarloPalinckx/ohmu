---
title: Auth and JWT
tags: [juice-shop, auth, jwt, security, rs256]
created: 2026-05-13
---

# Auth and JWT

Juice Shop uses RS256-signed JWTs for authentication. The token carries minimal claims, while the server-side `authenticatedUsers` map holds the enriched session data.

## Token Lifecycle

1. **Login** (`POST /rest/user/login`) — validates credentials, issues a signed JWT, stores an entry in `security.authenticatedUsers`, returns the token to the client.
2. **Request** — client sends `Authorization: Bearer <token>` on protected endpoints.
3. **Verification** — `security.isAuthorized()` middleware verifies the signature using the RS256 public key and populates `req.auth`.
4. **Enrichment** — `security.appendUserId()` middleware reads `security.authenticatedUsers[token]` and attaches `userId` and `bid` to `req`.

## JWT Claims

The token payload contains:

| Claim | Description |
|---|---|
| `id` | The user's database ID |
| `email` | User's email address |
| `iat` / `exp` | Issued-at and expiry timestamps |

The basket ID (`bid`) is **not** in the JWT — it lives only in the `authenticatedUsers` map.

## `security.authenticatedUsers`

An in-memory `Map<string, object>` keyed by the raw JWT string.

```ts
// Populated at login (simplified)
security.authenticatedUsers.put(token, {
  data: { id: user.id, email: user.email, bid: basket.id, … }
})
```

**Implication**: the map is process-local and ephemeral. It is lost on server restart. Tokens that were valid before a restart will pass JWT signature verification but will return `undefined` from `authenticatedUsers`, causing `appendUserId` to produce no userId.

## Key Helper Functions

| Function | What it does |
|---|---|
| `security.authorize(user)` | Signs and returns a new JWT for `user` |
| `security.from(req)` | Extracts the raw Bearer token string from `req.headers.authorization` |
| `security.authenticatedUsers.get(token)` | Returns the stored session object for a token |
| `security.appendUserId()` | Express middleware; appends `userId` (and `bid`) to `req` |
| `security.isAuthorized()` | Express middleware; validates JWT signature, sets `req.auth` |

## Accessing Identity in a Route Handler

```ts
// After isAuthorized + appendUserId middleware:
const userId = req.userId          // set by appendUserId
const bid    = req.bid             // basket ID, set by appendUserId
const email  = req.auth?.email     // from decoded JWT payload
```

## Watch Out For

- `req.userId` is only available when **both** `isAuthorized()` and `appendUserId()` are in the middleware chain. If a route skips `appendUserId`, handlers must fall back to `req.auth.id` from the decoded JWT.
- The RS256 key pair is static and checked into the repo (intentionally, for the training context). Do not treat these keys as secret.
- Token expiry is checked by `express-jwt`. An expired token returns `401` before any handler logic runs.

## Related Notes

- [[Routing and Middleware]]
- [[Basket API]]
