# Cloud Commitment Portfolio Optimizer — Coding Standards: Testing

Load this for all test work. Also load testing logic/live/E2E rules as applicable.

## Test Stack

- TypeScript unit/domain/API tests: Vitest.
- Zig optimizer/replay tests: `zig build test` with golden economic fixtures.
- Integration tests: real PostgreSQL, Redis, DuckDB, and local object storage.
- E2E tests: Playwright against a running Fastify/HTMX app.

## TDD Discipline

- Tests first for behavior changes: write failing tests, run RED, implement, run GREEN, then regression gate.
- `[SETUP]` scaffolding may be exempt when no executable behavior exists yet, but scripts/config should still get smoke checks when possible.
- Never edit, weaken, skip, or delete a valid failing test to make implementation pass.
- Never mock the code path being tested.

## Required Test Surfaces

- Auth/RBAC: 401/403/404 behavior, role matrix cells, tenant scoping.
- Imports: valid fixture ingestion, control totals, duplicate/idempotent upload, quarantine on schema drift.
- Pricing: version activation, stale/block behavior, frozen version report stability.
- Forecasts: distribution outputs, quality warnings, low-history fallback.
- Optimizer: economic formulas, constraints, infeasible output, frozen inputs, no average-only sizing.
- Reports/approvals: snapshot immutability, strict template token failures, state transitions.
- Notifications/adapters: local canonical rows, optional adapter disabled/retry behavior.
- Replay/backtests: no future leakage and deterministic seed replay.

## Anti-Cheat Rules

- No empty tests, broad assertion-only tests, or `expect(x).toBeDefined()` as proof of behavior.
- No fake in-memory DB/cache substitutes for services owned by this project.
- No direct DB fixture setup that bypasses production migrations/seeders for behavior that production code owns.
- No hardcoded tenant identity literals in templates/reports to satisfy tests.
- Every happy-path test needs at least one meaningful unhappy-path companion unless the surface is a trivial constant/type.

## Assertions

- Assert specific status codes, error codes, monetary cents, rounded percentages, state transitions, rows written, events enqueued, and rendered visible text.
- For financial math, assert exact integer cents and documented rounding behavior.
- For multi-tenant paths, create at least two tenants and assert Tenant A cannot observe Tenant B data or identity literals.

## Commands

| Gate | Command |
|------|---------|
| Unit/domain | `npm run test` |
| Zig | `zig build test` |
| Integration | `npm run test:integration` |
| E2E | `npm run test:e2e` |
| Full | `npm run test && zig build test && npm run test:integration && npm run test:e2e` |
| Golden fixtures | `npm run fixtures:golden` |
| Benchmark | `npm run bench:optimizer` |

## Reporting

- Do not claim a test passed without command evidence.
- If a required test cannot run because setup is not yet scaffolded, report the exact missing script/service as a warning.
