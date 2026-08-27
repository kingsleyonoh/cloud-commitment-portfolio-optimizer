# Managed Resource Cache

## What it establishes

One process-local async lifecycle primitive coalesces concurrent initialization, retries after failed initialization, serializes close against acquisition, and resets after idempotent close.

## Files

- `core/shared/lifecycle.ts`
- `tests/unit/shared/lazy-resource.test.ts`

## When to read this

Before creating or changing a cached process resource or its shutdown behavior.

## Contract

- Construct fresh caches for tests; do not mutate production globals.
- Factory rejection is not cached.
- Close/disposer failure propagates, while cache state still resets.
- Composition roots own signal handling; helpers only expose close/reset.

## Cross-references

- `.agent/knowledge/foundation/db-pool-singleton.md`
