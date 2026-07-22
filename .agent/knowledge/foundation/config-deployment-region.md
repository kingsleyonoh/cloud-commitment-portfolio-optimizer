# Deployment Region Configuration

## What it establishes

Development/test use `local` region defaults; production requires explicit equal compute/database region declarations.

## Files

- `core/config/deployment.ts`
- `core/config/env.ts`
- `tests/setup/deployment-config.test.mjs`

## When to read this

Before adding a process type, deployment target, or environment/config field related to topology.

## Contract

- Every production process consumes `DEPLOYMENT_REGION` and `DATABASE_REGION`.
- Mismatch fails with `DEPLOYMENT_REGION_MISMATCH`; missing production values fail closed.
- A matching string is configuration intent, not proof of physical placement.
- Cached config is immutable and failed parsing remains retryable.

## Cross-references

- PRD §10 and §14
