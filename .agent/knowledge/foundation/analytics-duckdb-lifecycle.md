# DuckDB Analytics Lifecycle

## What it establishes

DuckDB analytics has one managed process boundary and independently closeable per-operation workspaces, while the default adapter remains explicitly unavailable.

## Files

- `core/shared/duckdbAnalytics.ts`
- `tests/unit/shared/duckdb-analytics.test.ts`

## When to read this

Before adding analytical import/replay sessions or selecting a DuckDB runtime package.

## Contract

- Default health is non-ready and open fails with `DUCKDB_ADAPTER_UNAVAILABLE`.
- A manager closes all active sessions; each session closes its engine and removes its workspace.
- Failed engine initialization removes the workspace.
- Do not claim SQL readiness until a real DuckDB package and live tests are added.

## Cross-references

- PRD §7
