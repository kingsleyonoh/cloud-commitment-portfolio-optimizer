# Core SQL Command Module

## Purpose

Provides deterministic SQL discovery, checksum/order validation, isolated PostgreSQL execution, and observable advisory-lock cleanup. The current ordered product plan is additive through `0020_create_report_snapshots.sql`; accepted `0001`–`0019` bytes remain immutable.

## Key files

- `core/db/migrations.ts` — migration command boundary.
- `core/db/setup.ts` — first-run setup command boundary.
- `core/db/sql-plan.ts` — deterministic SQL-plan discovery.
- `core/db/sql-runner.ts` — transactional apply/validation path.
- `core/db/sql-runner-cleanup.ts` — cleanup error preservation.

## Dependencies

- Upstream: `pg`, Node filesystem/path APIs.
- Downstream: `scripts/db-migrate.ts`, `scripts/setup.ts`.

## Tests

- `tests/integration/` — isolated PostgreSQL migration/setup, catalog/behavior, concurrency, rollback, drift, and cleanup behavior.
- `price_table_versions` freeze tenant/provider/instrument version labels and SHA-256 content identity while permitting only forward draft/active lifecycle transitions.
- `price_table_items` are immutable same-tenant children, use exact BIGINT cent economics, and reject duplicate canonical dimensions within a version.
- `forecast_models` persist tenant-owned canonical scopes/config with draft/active/archived freeze semantics.
- `forecast_runs` persist deterministic windows/seeds plus completed output and quality metadata with terminal-row freeze semantics.
- `scenarios` persist tenant-owned forecast shock definitions with draft/ready/archived freeze semantics.
- `optimizer_policies` persist tenant risk/objective constraints with draft/active/archived freeze semantics.
- `optimizer_runs` freeze tenant/provider/instrument, forecast/scenario/policy inputs, and active price-version identities before queueing optimizer work.
- `recommendations` persist optimizer output economics, confidence/risk fields, explanation metadata, and approval state without mutable economic identity.
- `report_snapshots` persist immutable tenant-owned polymorphic source identity, bounded snapshot JSON, optional rendered artifact URIs, and queued/rendered/failed/archived lifecycle state.
- Forecast APIs/workers, forecasting algorithms, and optimizer economics remain separately owned.

## Cross-references

- `.agent/knowledge/foundation/db-pool-singleton.md`
