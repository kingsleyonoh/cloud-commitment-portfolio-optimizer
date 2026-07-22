# Application Database Pool

## What it establishes

Application runtime database access uses one lazy managed `pg.Pool` with real readiness and graceful close.

## Files

- `core/shared/db.ts`
- `tests/unit/shared/db-pool.test.ts`
- `tests/integration/db-pool.test.ts`

## When to read this

Before opening application PostgreSQL connections or adding database readiness checks.

## Contract

- Use `getDbPool` in app/worker composition; close with `closeDbPool`.
- Readiness executes `SELECT 1` and never converts connection failure to success.
- Migration commands retain their dedicated short-lived `pg.Client` lifecycle.
- Never log pool configuration or connection strings.

## Cross-references

- `.agent/knowledge/foundation/core-managed-resource-cache.md`
