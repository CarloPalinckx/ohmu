---
title: Architecture Overview
tags: [juice-shop, architecture, backend]
created: 2026-05-13
---

# Architecture Overview

OWASP Juice Shop is a deliberately vulnerable Node.js web application used for security training and CTF challenges. Understanding its structure is essential before navigating the source.

## Entry Points

| File | Role |
|---|---|
| `app.ts` | Bootstraps the Express app and calls `server.ts` |
| `server.ts` | Registers all middleware, REST routes, and Sequelize models |

`app.ts` is the binary entry point (`node app.ts`). Everything else is wired in `server.ts`.

## Layer Model

```
app.ts
  └── server.ts
        ├── Middleware (helmet, morgan, express-jwt, custom security.*)
        ├── REST routes  (/rest/*)   → routes/rest/<name>.ts
        ├── API routes   (/api/*)    → auto-generated Sequelize REST via epilogue/finale
        └── Static / Angular SPA    (frontend build)
```

## Key Directories

```
/
├── app.ts                  # Entry point
├── server.ts               # App wiring
├── routes/                 # Hand-written route handlers
│   └── rest/               # REST endpoints (basket, user, order, …)
├── models/                 # Sequelize model definitions
├── data/                   # Seed data (challenges, products, users)
├── lib/                    # Shared utilities (security, challengeUtils, …)
├── test/
│   ├── server/             # Mocha unit tests (no running server needed)
│   ├── api/                # Frisby/Jest integration tests (needs live server)
│   └── cypress/            # Cypress end-to-end tests (needs live server)
└── frontend/               # Angular SPA source
```

## Dependency Highlights

- **Express** — HTTP framework
- **Sequelize** — ORM; SQLite by default (file: `data/juiceshop.sqlite`)
- **finale-rest** (formerly epilogue) — auto-generates CRUD `/api/*` endpoints from Sequelize models
- **express-jwt** — decodes Bearer tokens and populates `req.auth`
- **jsonwebtoken** — signs/verifies JWTs (RS256)

## Watch Out For

- The `/api/*` routes are auto-generated from models at startup — there is no explicit route file for them. Configuration lives in the `finale` setup block inside `server.ts`.
- SQLite is wiped and re-seeded on every fresh start unless `NODE_ENV=test` suppresses it.

## Related Notes

- [[Test Infrastructure]]
- [[Routing and Middleware]]
- [[Auth and JWT]]
