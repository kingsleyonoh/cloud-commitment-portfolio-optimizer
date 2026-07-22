# Core Shared Primitives Module

## Purpose

Owns Phase 0 managed shared-resource contracts for PostgreSQL, queue, object storage, DuckDB availability, structured logging, and safe error normalization.

## Key files

- `core/shared/db.ts`
- `core/shared/jobQueue.ts`
- `core/shared/objectStore.ts`
- `core/shared/duckdbAnalytics.ts`
- `core/shared/logger.ts`
- `core/shared/errors.ts`
- `core/shared/lifecycle.ts`

## Dependencies

- Upstream: typed `core/config/` values and installed Phase 0 packages.
- Downstream: future app/domain modules; no reachable product app is claimed in Phase 0.

## Tests

- `tests/unit/shared/`
- `tests/integration/db-pool.test.ts`

## Cross-references

- `.agent/knowledge/foundation/_index.md`
