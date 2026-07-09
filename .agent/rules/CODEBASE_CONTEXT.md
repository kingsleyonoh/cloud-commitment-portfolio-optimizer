# Cloud Commitment Portfolio Optimizer — Codebase Context

Last updated: 2026-07-09
Template synced: 2026-07-09
PRD: `docs/cloud-commitment-portfolio-optimizer_prd.md`
Status: Greenfield bootstrap complete; implementation starts from `docs/progress.md` Phase 0.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Zig 0.14 for deterministic optimizer/replay workers; TypeScript 5 for API/UI glue |
| Framework | Fastify API + HTMX/Tailwind server-rendered UI; Zig CLI/worker binaries invoked through job queue |
| Database | PostgreSQL 16; DuckDB for analytical replay over Arrow/Parquet imports |
| Queue/Cache | Redis 7 |
| Hosting | Docker Compose for self-host; VPS/Railway/Fly-compatible container deployment |
| Testing | Vitest, Fastify inject/integration tests, Playwright, Zig unit/golden tests |
| Observability | OpenTelemetry traces, structured JSON logs, Sentry-compatible DSN, Uptime Kuma/BetterStack-compatible checks |

## Commands

| Purpose | Command |
|---|---|
| Install dependencies | `npm install` |
| Check Zig toolchain | `zig version` (must be 0.14) |
| Start infra | `docker compose up -d postgres redis` |
| Stop infra | `docker compose down` |
| Check infra | `docker compose ps` |
| Run migrations | `npm run db:migrate` |
| First-run setup / seed | `npm run setup` |
| Dev API/UI server | `npm run dev` |
| Dev worker | `npm run worker:dev` |
| Run tests | `npm run test && zig build test && npm run test:integration && npm run test:e2e` |
| Run tests (unit only) | `npm run test` |
| Run tests (integration only) | `npm run test:integration` |
| Run E2E tests | `npm run test:e2e` |
| Run Zig tests | `zig build test` |
| Lint | `npm run lint` |
| Build/typecheck | `npm run build` |
| Golden fixtures | `npm run fixtures:golden` |
| Benchmark | `npm run bench:optimizer` |

## Project Structure

| Path | Purpose |
|---|---|
| `apps/api/` | Fastify API, auth middleware, REST routes |
| `apps/web/` | HTMX server-rendered UI templates/routes |
| `apps/worker/` | Queue consumers invoking Zig optimizer/replay binaries |
| `core/shared/` | `dbPool`, `jobQueue`, `objectStore`, `duckdbAnalytics`, logger, errors |
| `core/tenant/` | Tenant context, RBAC policy, API key hashing |
| `core/imports/` | Provider parsers and canonical usage normalization |
| `core/pricing/` | Price table validation and instrument models |
| `core/forecasting/` | Forecast models and scenario generation |
| `core/optimizer/` | Zig optimizer source, solver bindings, efficient frontier logic |
| `core/replay/` | Deterministic replay/backtest engine |
| `core/approvals/` | Approval state machine and snapshots |
| `core/reports/` | Strict report renderer and templates |
| `core/notifications/` | In-app notifications and preferences |
| `core/adapters/` | Optional Notification Hub, Workflow Engine, and disabled Invoice Recon adapters |
| `db/migrations/` | Tenant-scoped PostgreSQL migrations |
| `tests/` | Unit, integration, E2E, and golden fixtures |

## Shared Foundation

| Primitive | Planned path | Establishes |
|---|---|---|
| Tenant context | `core/tenant/context.ts` | Resolves tenant_id, actor, role for API/job paths |
| RBAC policy | `core/tenant/rbac.ts` | Explicit Roles × Resource Actions matrix cases |
| DB pool/repository base | `core/shared/db.ts` | Tenant-leading query helpers and transactions |
| Job queue | `core/shared/jobQueue.ts` | Redis queues, idempotency, worker shutdown |
| Object store | `core/shared/objectStore.ts` | Local/S3-compatible artifact persistence |
| DuckDB analytics | `core/shared/duckdbAnalytics.ts` | Analytical replay/import temp DB lifecycle |
| Error responses | `core/shared/errors.ts` | PRD §8b error envelope and safe 401/403/404 behavior |
| Report renderer | `core/reports/renderer.ts` | Strict templates and frozen snapshots |
| Event adapter | `core/adapters/eventAdapter.ts` | Optional ecosystem event enqueue/retry boundaries |

## Tenant Model

Tenant-scoped by default. API clients use `X-API-Key` hashed against `tenants.api_key_hash`; UI users use JWT with tenant claim. Every data-bearing table includes `tenant_id`; repository methods require tenant_id. Cross-tenant resource IDs return 404 or 403 per PRD §5.1 without leaking existence.

## Key Modules

- Tenant/auth/RBAC — tenant context, API keys, JWT, role/action matrix, audit logging.
- Billing import/normalization — CSV/Parquet/JSON/native CUR parsing into canonical usage rows with quarantine on drift.
- Price table/instrument modeling — versioned price fixtures, active version rules, frozen checksum references.
- Forecast/scenario — usage distributions and quality metrics, not flattened averages.
- Portfolio optimizer — Zig integer-cent economic kernel and risk-bounded efficient frontier.
- Replay/backtest — deterministic historical decision replay with no future leakage.
- Approvals/reports — immutable snapshots, strict templates, report/approval transition contract.
- Notifications/adapters — local in-app canonical notifications and optional external mirrors/triggers.

## External Integrations

| System | Required? | Notes |
|---|---|---|
| Notification Hub | Optional | `POST /api/events`, health check, feature-flagged, core never depends on it |
| Workflow Automation Engine | Optional | Manual workflow execution for approval orchestration |
| Invoice Reconciliation Engine | Disabled future placeholder | No outbound calls until `INVOICE_RECON_CONTRACT_VERIFIED=true` with exact endpoint |
| AWS/Azure/GCP billing exports | Input data | MVP file/fixture imports; optional live adapters later |

## Deep References

| Surface | Planned path |
|---|---|
| API routes | `apps/api/routes/` |
| HTMX views | `apps/web/views/` |
| Workers | `apps/worker/` |
| Tenant/RBAC | `core/tenant/` |
| Imports | `core/imports/` |
| Pricing | `core/pricing/` |
| Forecasting | `core/forecasting/` |
| Optimizer | `core/optimizer/` |
| Reports/templates | `core/reports/` |
| Notifications | `core/notifications/` |
| Adapters | `core/adapters/` |
| Migrations | `db/migrations/` |
| Golden fixtures | `tests/fixtures/` |

## Key Patterns & Conventions

- Freeze economic identity before queued execution: forecast run, scenario, policy, provider/instrument, price table version IDs, random seed.
- Amounts are integer cents; display percentages round half-up to 2 decimals and internal percentages to 4 decimals.
- Use local services for integration tests; do not mock PostgreSQL/Redis/DuckDB paths under your control.
- Optional adapters must fail open for core flow and record retry/disabled status in `ecosystem_events`.
- Strict template rendering: missing report/notification token fails render and records an error; never silently fallback.

## Gotchas Seeded from Template Knowledge

| Stack | Gotcha |
|---|---|
| Node.js + TypeScript | Keep typecheck/build and runtime entrypoint wiring separate; prove routes/jobs are reachable through production registration. |
| PostgreSQL | Tenant-leading composite indexes are required for every cross-tenant table and query path. |
| Secrets | Env examples use names/placeholders only; scan before commits with `scripts/scan-secrets.sh`/`.ps1`. |
| Test fabrication | Green claims require artifacts from real commands against local services, not mocked success output. |

## Environment Variables

See `.env.example` for full names. Required local categories: app, database/queue, tenant management, import/pricing/forecast/optimizer, reports/approvals, optional integrations, observability.
