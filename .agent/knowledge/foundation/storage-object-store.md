# Local Object Store

## What it establishes

The canonical enabled Phase 0 object store is a managed local-filesystem adapter with traversal-safe keys and atomic writes.

## Files

- `core/shared/objectStore.ts`
- `tests/unit/shared/object-store.test.ts`

## When to read this

Before persisting or loading import, report, replay, or optimizer artifacts.

## Contract

- Keys are non-empty safe relative forward-slash paths; absolute/traversal/backslash keys fail closed.
- Writes use unique temporary files and atomic rename.
- Health proves the configured root is writable.
- Unsupported S3 mode must remain config-invalid until a real adapter and tests exist.

## Cross-references

- PRD §7 and §10
