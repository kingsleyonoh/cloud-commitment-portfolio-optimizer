# Phase 1 Close-Out Evidence Matrix

Date: 2026-08-26  
Scope: PRD §2b `✓ P1` cells only. Future `✓ P2`/`✓ P3` cells remain backlog metadata.

## Result

PASS. Every `✓ P1` Provider × Instrument, Import Source × Billing Format, Roles × Resource Actions, and accepted-schema API-key actor cell has production route/handler/test reachability.

During this audit, AWS Compute Savings Plan support was functionally present through generic price-table and optimizer handlers, but the PRD reachability rule also names provider/instrument-specific parser and optimizer seams. That gap was closed with used, exported seams:

- `parseAwsComputeSavingsPlanPriceTable` in `core/price-tables/price-tables-input.ts`
- `optimizeAwsComputeSavingsPlan` in `core/optimizer-runs/optimizer-worker.ts`

## Provider × Instrument Matrix

| PRD cell | Status | Production reachability | Test evidence |
|---|---:|---|---|
| AWS × Compute Savings Plan | PASS | `apps/api/routes/price-tables-schema.ts` and `core/price-tables/price-tables-input.ts` accept only `provider: "aws"` + `instrument: "aws_compute_savings_plan"` for P1 price-table creation. `apps/api/routes/optimizer-runs-schema.ts` and `core/optimizer-runs/optimizer-runs-input.ts` accept only the same provider/instrument for optimizer-run creation. `core/optimizer-runs/optimizer-worker.ts` calls `optimizeAwsComputeSavingsPlan` before frontier/recommendation persistence. | `tests/unit/aws-compute-savings-plan-reachability.test.ts`, `tests/integration/price-tables-route.test.ts`, `tests/integration/optimizer-runs-route.test.ts`, `tests/integration/optimizer-worker.test.ts`, `tests/e2e/first-run-workflow.spec.ts`, `core/optimizer` Zig tests. |

Non-P1 cells were not counted as Phase 1 completion. AWS Reserved Instances, Azure Savings Plans, Azure Reservations, and GCP Committed Use Discounts remain Phase 2 work. Excluded PRD cells remain explicitly out of scope.

## Import Source × Billing Format Matrix

| PRD cell | Status | Production reachability | Test evidence |
|---|---:|---|---|
| Synthetic Scenario Generator × CSV | PASS | `apps/api/routes/imports-schema.ts` accepts `source: "synthetic"` + `format: "csv"`. `core/imports/imports-service.ts` dispatches to `parseSyntheticCsvImport` in `core/imports/synthetic-csv-parser.ts`. | `tests/integration/imports-route.test.ts`, `tests/integration/imports-ui-route.test.ts`, `tests/e2e/first-run-workflow.spec.ts`. |
| AWS Cost & Usage Report × CSV | PASS | `apps/api/routes/imports-schema.ts` accepts `source: "aws_cur"` + `format: "csv"`. `core/imports/imports-service.ts` dispatches to `parseAwsCurCsvImport` in `core/imports/aws-cur-csv-parser.ts`. | `tests/integration/imports-route.test.ts`, `tests/integration/imports-ui-route.test.ts`, `tests/e2e/first-run-workflow.spec.ts`. |

P2/P3 import formats and native CUR export remain backlog. Manual override import is not Phase 1-owned.

## Roles × Resource Actions Matrix

| P1 surface | Status | Production reachability | Test evidence |
|---|---:|---|---|
| Tenant Admin allowed P1 actions | PASS | `core/tenant/rbac.ts` maps every Tenant Admin `✓ P1` action to `allow_p1`, including tenant profile, cloud accounts, users, API keys, imports, price tables, forecast models/runs, optimizer policies/runs, recommendations, reports, and tenant settings. Protected route guards are registered in `core/tenant/protected-route-actions.ts` and enforced by route `requireAction` calls under `apps/api/routes`. | `tests/unit/tenant-rbac-matrix.test.ts`, `tests/integration/rbac-route-guard.test.ts`, plus route-specific integration tests for each implemented P1 surface. |
| FinOps Analyst allowed/denied P1 actions | PASS | `core/tenant/rbac.ts` maps FinOps Analyst P1 operating actions to `allow_p1` while denying governance mutations such as deactivate account, user management, API-key rotation/management, price-table activation, optimizer-policy writes, and tenant-settings writes. | `tests/unit/tenant-rbac-matrix.test.ts`, `tests/integration/rbac-route-guard.test.ts`, route-specific 403/200 coverage. |
| Finance Approver and Read-only Auditor Phase 1 behavior | PASS | `core/tenant/rbac.ts` keeps their Phase 1 current-route access denied unless a matrix cell is future-owned; `canPerformAuthAction` allows only current `allow_p1` cells. | `tests/unit/tenant-rbac-matrix.test.ts`, `tests/integration/rbac-route-guard.test.ts`. |

Future approval, audit-log, notification, scenario, adapter, and broader read-only cells remain Phase 2/3 backlog and are not marked complete here.

## Accepted-Schema API-Key Actor Overlay

PASS. `core/tenant/rbac.ts` defines a fixed API-key allow-list rather than inheriting a user role. It allows current automation-safe P1 read/write surfaces for tenant profile, cloud accounts, imports, price-table reads, forecast models/runs, optimizer runs, recommendations, and reports. It denies governance operations including cloud-account deactivation, users, API-key metadata/rotation, price-table activation, optimizer-policy reads/writes, tenant settings, notifications, audit log, and ecosystem adapter configuration.

Evidence:

- `tests/unit/tenant-rbac-matrix.test.ts` validates the PRD-derived API-key overlay against every canonical action.
- `tests/integration/rbac-route-guard.test.ts` verifies 200/403 behavior over a real authenticated Fastify app and PostgreSQL-backed API key.
- Route-specific tests cover API-key reachability where the P1 surface permits it.

## Command Evidence

Commands run during close-out:

- `npm run test -- tests/unit/aws-compute-savings-plan-reachability.test.ts` — RED before named seams existed, then GREEN after implementation.
- `TEST_DATABASE_ADMIN_URL=postgresql://user@127.0.0.1:55432/postgres TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:integration -- tests/integration/price-tables-route.test.ts tests/integration/optimizer-worker.test.ts` — sharded runner executed the full integration suite and passed 16/16 shards after the seam change.

Additional recent Phase 1 gates from the immediately preceding slices:

- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm run build` — pass.
- `npm run format:check` — pass.
- `npm run test:setup` — pass.
- `npm run test` — pass.
- `cd core/optimizer; zig build test` — pass.
- `npm run test:e2e` — pass, including `tests/e2e/first-run-workflow.spec.ts`.
- `npm audit --audit-level=moderate` — pass with zero vulnerabilities.

## Close-Out Decision

Phase 1 can be marked complete. The remaining unchecked ledger items are Phase 2 approval/replay/matrix breadth/integration stubs and Phase 3 hardening/observability/deployment/polish work.
