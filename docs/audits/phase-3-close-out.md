# Phase 3 close-out evidence

Audit scope is the P3 hardening checklist and the remaining `✓ P3` import cell. The build is locally release-ready; deploy/push and live provider credentials remain explicitly operator-gated.

## API, imports, and performance

- `tests/unit/openapi-surface.test.ts` checks every entry in `PROTECTED_ENDPOINT_ACTIONS`, public auth/session routes, and health routes for an operation ID, security declaration where required, concrete responses, and no TODO placeholders. Existing route-specific OpenAPI tests cover metadata, rotation, sessions, and tenant profile contracts.
- `tests/integration/imports-route.test.ts` proves `source=aws_cur, format=native_cur` uses the canonical AWS CUR parser and exact control totals. The native boundary is file/fixture-only; no live AWS credential or network call is required or made.
- `scripts/bench-optimizer.ts` is the deterministic benchmark command. A local run processed 1,000,000 replay line items in 604.35ms and measured optimizer p95 at 211.60ms across 10,000 candidates and 25 iterations; both are under the PRD limits of 60s and 30s. Repeat runs are expected to vary with host load.

## Observability and operations

`/health`, `/health/db`, and `/health/ready` have bounded dependency probes. Request logs carry request/trace/span IDs through `core/observability/trace-context.ts`; worker polling emits cycle and PostgreSQL queue-lag metrics. Thresholds are recorded in `docs/observability/alerts.yml`. OTLP export remains an explicit optional collector boundary; no local test claims a live collector.

## Frontend and privacy

`docs/audits/frontend-quality.md` records `MOBILE_VIEWPORT_PASS`, `PRIVACY_MATRIX_PASS`, `BUNDLE_DYNAMIC_IMPORT_AUDIT_PASS`, `FRONTEND_IMPECCABLE_AUDIT_PASS`, and `FRONTEND_IMPECCABLE_POLISH_PASS`. The landing route, 390px-safe approval controls, semantic tables, reduced-motion styles, upload warnings, and no-dashboard-JavaScript contract are covered by the named unit/integration tests.

## Deployment and smoke

`Dockerfile` compiles application and migration entrypoints, copies report/notification templates and fixture inputs, and retains the pinned Zig artifact boundary. `docker-compose.prod.yml` adds a migration completion gate and persistent worker. `docs/deployment.md` covers start, upgrade, backup, restore, and readiness checks without secrets. Smoke evidence is the Playwright first-run workflow plus approval/report/integration route suites and production Compose contract tests.

## Explicit external gate

No live AWS/Azure/GCP credentials, external Notification Hub, or Workflow Engine endpoint was supplied or contacted. Adapter fixtures and disabled-mode behavior are local and deterministic. Invoice Reconciliation remains disabled with `ENDPOINT_CONTRACT_UNVERIFIED` until its exact endpoint contract is verified. Publishing, deployment, DNS, paid resources, and live integration enablement remain user-controlled actions.
