# Core Configuration Module

## Purpose

Parses typed environment/configuration declarations, separately inventories runner-only live-service keys, and enforces production-only region, URL, adapter, and pool boundaries.

## Key files

- `core/config/env.ts` — bounded public configuration facade.
- `core/config/env-schema.ts` — separate application, deployment-only, and test-runner key declarations plus application config types.
- `core/config/env-runtime.ts` — runtime/production parsing and fail-closed checks.
- `core/config/deployment.ts` — deployment/database region parity.

## Dependencies

- Upstream: Node platform APIs only.
- Downstream: Phase 0 shared resource adapters and setup/deployment checks.

## Environment ownership boundary

- `ENV_KEYS` contains parser-owned application inputs and `DEPLOYMENT_ENV_KEYS` contains Compose-only deployment inputs.
- `TEST_ENV_KEYS` contains exactly `TEST_DATABASE_ADMIN_URL` and `TEST_REDIS_URL`; strict example/local parity includes them, but `parseEnvironment` and `AppConfig` exclude them.
- `.env.example` documents both runner-only keys blank. Local/CI test environments must privately supply real isolated PostgreSQL 16 and Redis 7 endpoints without committed defaults.

## Tests

- `tests/setup/environment-contract.test.mjs`
- `tests/setup/environment.test.mjs`
- `tests/setup/deployment-config.test.mjs`
- `tests/setup/production-deployment.test.mjs`

## Cross-references

- `.agent/knowledge/foundation/config-deployment-region.md`
- `.agent/knowledge/foundation/db-pool-singleton.md`
