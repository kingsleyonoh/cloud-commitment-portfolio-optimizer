# Phase 2 close-out evidence

Audit scope is every `✓ P1` and `✓ P2` cell in PRD §2b. P3 cells are intentionally excluded from this audit.

## Provider × instrument

`tests/unit/aws-compute-savings-plan-reachability.test.ts` exercises the parser and optimizer seams for AWS Compute Savings Plan, AWS Reserved Instance, Azure Savings Plan, Azure Reservation, and GCP Committed Use Discount. `tests/integration/price-table-route.test.ts`, `tests/integration/optimizer-runs-route.test.ts`, and `tests/integration/optimizer-worker.test.ts` prove route creation, frozen price versions, worker dispatch, recommendation persistence, and tenant isolation.

Unsupported provider/instrument cells are rejected by the strict parser/dispatch boundary and are not presented as fallback pricing. The UI labels instrument scope and blocked/infeasible states.

## Import source × format

`tests/integration/imports-route.test.ts` covers the recorded AWS, Azure, GCP, and synthetic CSV/Parquet/JSON snapshot matrix plus the small synthetic manual override. `tests/fixtures/{aws,azure,gcp,synthetic}` contains the replayable inputs. Control totals are compared by provider, service, region, and month; malformed or drifting files quarantine without partial canonical rows.

## Roles × resource actions

`tests/unit/tenant-rbac-matrix.test.ts` derives the role/action expectations from the canonical PRD matrix and checks every explicit allow, future/deny cell, API-key overlay, and protected endpoint registry entry. Route suites exercise same-tenant ownership, cross-tenant hiding, API-key restrictions, mutation roles, pagination, and limiter behavior.

## Phase 2 owned surfaces

Approval migrations/routes/expiry, deterministic backtests, scenarios, integrations, notifications, notification preferences, audit log, and their server-rendered screens are covered by the focused integration suites named in `docs/progress.md`. Adapter-disabled tests prove local flow remains available. The Invoice Reconciliation adapter remains a verified disabled placeholder and is not counted as an active cell.

Evidence commands:

```bash
npx vitest run tests/unit/aws-compute-savings-plan-reachability.test.ts tests/unit/tenant-rbac-matrix.test.ts
npx vitest run tests/integration/imports-route.test.ts tests/integration/integrations-route.test.ts tests/integration/approvals-ui-route.test.ts
npm run typecheck
npm run lint
```
