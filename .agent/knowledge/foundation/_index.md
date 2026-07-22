# Shared Foundation — Index

> **One file per foundation primitive.** This index is a human-readable catalog, rewritten by the AI whenever a sibling file is added, renamed, or removed. Never append to a single growing table — write a new sibling instead. See `.agent/rules/CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Catalog

| File | Summary |
|------|---------|
| `analytics-duckdb-lifecycle.md` | DuckDB manager/session ownership and explicit unavailable boundary. |
| `config-deployment-region.md` | Typed immutable compute/database region parity. |
| `core-error-normalization.md` | Stable safe error codes and exact client envelope. |
| `core-managed-resource-cache.md` | Coalesced async initialization, retry, close, and reset. |
| `db-pool-singleton.md` | Application `pg.Pool` ownership and migration-client separation. |
| `jobs-queue-adapter.md` | Idempotent queue contract and disabled fail-closed boundary. |
| `observability-structured-logger.md` | Structured context, recursive redaction, and sink lifecycle. |
| `storage-object-store.md` | Traversal-safe atomic local filesystem object persistence. |

## What belongs here

Primitives imported by 3+ modules or that establish a project-wide contract. Examples: config loading, DB pool bootstrap, HTTP server bootstrap, auth middleware, shared error types, logging, feature flags, i18n.

## Mandatory reading rule

`CODING_STANDARDS.md` requires these files to be read **in full** before writing any new code that touches the surface they establish. The individual files in this directory replace the old flat `## Shared Foundation` table in `CODEBASE_CONTEXT.md`.

## How to add a new foundation primitive

1. Filename pattern: `category-slug.md` (e.g. `core-config-loading.md`, `db-pool-singleton.md`, `plugin-auth.md`).
2. Use the bounded `What it establishes` / `Files` / `When to read this` / `Contract` / `Cross-references` shape demonstrated by the existing sibling files.
3. Add one row to the `## Catalog` table above.

## Why directory-per-kind

Shared Foundation grows every time a new cross-cutting primitive lands. One row per primitive in a flat table becomes impossible to maintain once the project has 10+ primitives. Directory-per-kind scales — and each file is the right size to read "in full" without triggering context pressure.
