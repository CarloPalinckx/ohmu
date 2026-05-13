---
title: Test Infrastructure
tags: [juice-shop, testing, mocha, jest, frisby, cypress]
created: 2026-05-13
---

# Test Infrastructure

Juice Shop has three distinct test suites targeting different levels of the stack. Knowing which suite to use — and what each requires — saves a lot of confusion.

## Suite Summary

| Suite | Location | Runner | Server needed? |
|---|---|---|---|
| Unit tests | `test/server/` | Mocha | No |
| API integration tests | `test/api/` | Jest + Frisby | **Yes** (port 3000) |
| End-to-end tests | `test/cypress/` | Cypress | **Yes** (port 3000) |

## Running Each Suite

### Unit tests (Mocha)

```bash
npm test
# or specifically:
npx mocha --timeout 10000 test/server/**/*.ts
```

These test individual functions and middleware in isolation. No network required.

### API integration tests (Jest / Frisby)

```bash
# First, start the server in one terminal:
npm start

# Then in another terminal:
npm run frisby
# or:
npx jest test/api/
```

Frisby tests make real HTTP requests to `http://localhost:3000`. **The server must be running first.** Tests will silently fail or error out if the port is not available.

### End-to-end tests (Cypress)

```bash
# Server must be running first
npm run cypress:open   # interactive
npm run cypress:run    # headless CI mode
```

## Watch Out For

- **API tests require a live server.** This is the most common gotcha. If you run `npm run frisby` cold, every test will fail with connection errors.
- Unit tests import source files directly — TypeScript is compiled on-the-fly via `ts-node` / `ts-mocha`. Compilation errors in source files will surface here first.
- The SQLite database is re-seeded at server startup. If a test depends on a specific data state, start a fresh server instance.
- API tests use `supertest`-style Frisby wrappers. Response body assertions are chained; unhandled promise rejections from failed assertions may not surface clearly without `--verbose`.

## Adding Tests

- **New server-unit test**: add a `*.spec.ts` file in `test/server/`. Follow the existing Mocha `describe`/`it` pattern.
- **New API test**: add a `*ApiSpec.ts` file in `test/api/`. Import `frisby` and target `http://localhost:3000`.

## Related Notes

- [[Architecture Overview]]
