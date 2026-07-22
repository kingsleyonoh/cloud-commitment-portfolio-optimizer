# Core Configuration Module

## Purpose

Parses typed Phase 0 environment/configuration declarations and enforces production-only region, URL, adapter, and pool boundaries without claiming an application runtime exists.

## Key files

- `core/config/env.ts` — bounded public configuration facade.
- `core/config/env-schema.ts` — environment key/type declarations.
- `core/config/env-runtime.ts` — runtime/production parsing and fail-closed checks.
- `core/config/deployment.ts` — deployment/database region parity.

## Dependencies

- Upstream: Node platform APIs only.
- Downstream: Phase 0 shared resource adapters and setup/deployment checks.

## Tests

- `tests/setup/environment.test.mjs`
- `tests/setup/deployment-config.test.mjs`
- `tests/setup/production-deployment.test.mjs`

## Cross-references

- `.agent/knowledge/foundation/config-deployment-region.md`
- `.agent/knowledge/foundation/db-pool-singleton.md`
