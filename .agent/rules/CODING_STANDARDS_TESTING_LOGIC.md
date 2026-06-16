# Cloud Commitment Portfolio Optimizer — Coding Standards: Logic & Correctness Testing

Load this for domain logic, financial math, tenant isolation, reports, jobs, events, and correctness-sensitive UI/API behavior.

## Business Logic Correctness

Every feature must prove the business outcome, not just code execution. Required when a change:

- calculates savings, downside loss, utilization, confidence, amortization, regret, queue lag, or limits;
- changes lifecycle status for imports, price tables, forecasts, optimizer runs, recommendations, approvals, reports, notifications, or adapter events;
- authorizes/denies actions;
- renders reports, PDFs, notifications, approvals, audit rows, events, or exports;
- writes data later consumed by a worker, report, cache, replay, or adapter.

Tests must assert the source of truth, observable paths, internal-only values not leaking, and at least one failure mode.

## Multi-Tenant Fixtures Mandatory

Because this project is tenant-scoped, every suite touching tenant data must create at least two tenants with distinct identity literals: legal name, full legal name, display name, address, registration, contact, default currency/timezone, and wordmark.

- Query/API/job/report tests must prove Tenant A cannot read or mutate Tenant B data.
- Template/report/notification/PDF tests must render both tenants and grep for the other tenant's identity literals.
- Cross-tenant resource access should assert the correct 404/403 behavior and no data leakage.

## Economic Kernel Tests

- Golden fixtures must assert integer cents and documented rounding for: AWS Compute Savings Plan partial utilization, upfront RI amortization, Azure reservation region mismatch, GCP CUD term mismatch, and no-action baseline.
- Assert formula pieces: gross savings, unused waste, upfront amortization, liquidity penalty, net savings, p95 downside loss, expected savings, utilization percentiles, and feasibility constraints.
- Tests must fail if average usage replaces distributional risk inputs.

## Snapshot and Replay Tests

- Recommendation reports and approval packets must remain unchanged after tenant identity edits and price table supersession.
- Report re-rendering must use frozen snapshot JSON, not live DB recomputation.
- Backtests must not access future usage or future price tables relative to decision month.
- Replays with the same seed and frozen inputs must be deterministic.

## Matrix Coverage Tests

Coverage-matrix cells from the PRD drive phase close-out:

- Provider × Instrument: reachable parser/price model/optimizer symbols and API/UI evidence for owned-phase `✓` cells; explicit blocks for `✗` cells.
- Import Source × Billing Format: parser command/handler coverage for owned-phase `✓` cells; quarantine/unsupported behavior for invalid combinations.
- Roles × Resource Actions: explicit allow/deny policy cases and 200/403 tests for each owned-phase cell.

Future-owner cells are backlog metadata, not fake placeholder reachability.

## Edge and Failure Coverage

- Required fields, uniqueness, FK behavior, invalid enums, duplicate requests, idempotency keys, stale price tables, low-quality forecasts, infeasible optimizer policies, adapter retry/failure, and worker restart recovery.
- Every happy path needs a companion unhappy path unless truly trivial.
- Test names must describe business behavior: e.g., `blocks_recommendation_when_price_table_is_stale`, not `test_status_code`.

## Performance Awareness

- Correctness can pass while load explodes. For pages/endpoints with 3+ backend operations, consider call count or p95 assertions.
- After batches adding 5+ operations, run a compound load check against real pages/routes.
- Benchmarks must cover PRD targets for optimizer duration and 12-month replay.
