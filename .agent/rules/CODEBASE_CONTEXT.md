# Cloud Commitment Portfolio Optimizer — Codebase Context

Last updated: 2026-06-16
PRD: `docs/cloud-commitment-portfolio-optimizer_prd.md`

## Product Summary

Tenant-scoped FinOps decision system for CFOs, CTOs, and Heads of FinOps. It imports billing exports and versioned price tables, forecasts eligible usage, simulates downside risk, builds efficient portfolios of cloud commitments, and emits auditable buy / renew / resize / sell-or-exchange / no-action recommendations.

Core principle: optimize risk-bounded net savings, not headline savings. Every recommendation must be replayable from frozen inputs: billing snapshot, price-table versions, forecast config, policy, random seed, and approval/report snapshots.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5 for API/UI/worker glue; Zig 0.14 for deterministic optimizer/replay workers |
| Framework | Fastify API; HTMX + Tailwind server-rendered UI; Zig CLI/worker binaries invoked from queue jobs |
| Database | PostgreSQL 16 with tenant-leading indexes; DuckDB for analytical replay over Arrow/Parquet imports |
| Local Services | local PostgreSQL, local Redis, DuckDB, local filesystem object storage |
| Queue/Cache | Redis 7 |
| Storage Formats | Apache Arrow/Parquet, CSV, JSON snapshots, local object store under `.data/objects` |
| Package Manager | npm |
| Test Runners | Vitest, Playwright, Zig unit tests |
| Build Tool | TypeScript/Vite/Tailwind plus `zig build` |
| Hosting | Docker Compose self-host first; VPS/Railway/Fly-compatible containers |

## Project Structure

```text
cloud-commitment-portfolio-optimizer/
├── apps/api/                 # Fastify API, auth middleware, REST routes
├── apps/web/                 # HTMX server-rendered UI templates/routes
├── apps/worker/              # Queue consumers invoking Zig workers
├── core/tenant/              # tenantContext, RBAC, API key hashing
├── core/imports/             # provider parsers + normalization
├── core/pricing/             # price tables + instrument models
├── core/forecasting/         # forecast models + scenario generation
├── core/optimizer/           # Zig optimizer source, CLI, golden tests
├── core/replay/              # deterministic backtest/replay engine
├── core/approvals/           # approval state machine + snapshots
├── core/reports/             # strict report renderer + templates
├── core/notifications/       # in-app notifications + preferences
├── core/adapters/            # optional Hub/Workflow/future Invoice Recon adapters
├── core/audit/               # audit log + retention jobs
├── core/shared/              # dbPool, jobQueue, objectStore, duckdbAnalytics, logger, errors
├── db/migrations/            # PostgreSQL migrations
├── tests/{unit,integration,e2e,fixtures}/
├── scripts/                  # setup, fixture import, replay helpers
├── build.zig                 # Zig optimizer/replay build
├── docker-compose.yml
└── openapi.yaml
```

## Key Domain Modules

| Module | Purpose |
|--------|---------|
| Tenant/Auth/RBAC | Resolve tenant context, API key/JWT auth, role/resource authorization |
| Billing Import | Ingest AWS/Azure/GCP/synthetic exports; quarantine schema drift |
| Price Tables | Version commitment prices and freeze versions into optimizer runs |
| Forecast/Scenario | Produce distributional usage forecasts, quality metrics, shocks |
| Portfolio Optimizer | Simulate candidates and optimize expected savings under downside constraints |
| Replay/Backtest | Re-run historical decisions without future leakage |
| Reports/Approvals | Freeze recommendation/approval snapshots and render HTML/PDF/JSON |
| Notifications | Local in-app notifications and preferences before optional external mirrors |
| Ecosystem Adapters | Optional Notification Hub and Workflow Engine; Invoice Recon disabled until contract verified |

## Database Schema Summary

Every data-bearing table is tenant-scoped by `tenant_id` and tenant-leading indexes unless the table itself is `tenants`.

| Area | Tables |
|------|--------|
| Identity | `tenants`, `users`, `cloud_accounts` |
| Imports | `import_batches`, `usage_line_items` |
| Pricing | `price_table_versions`, `price_table_items` |
| Forecast/Optimization | `forecast_models`, `forecast_runs`, `scenarios`, `optimizer_policies`, `optimizer_runs`, `recommendations` |
| Approval/Reports | `approvals`, `backtest_runs`, `report_snapshots` |
| Ops/Comms | `ecosystem_events`, `notifications`, `notification_preferences`, `audit_log` |

## External Integrations

| Service | Purpose | Required? | Auth |
|---------|---------|-----------|------|
| Notification Hub | Optional event/email mirror for recommendation, risk, approval, backtest, and adapter-failure events | No | `X-API-Key` from env |
| Workflow Automation Engine | Optional approval workflow trigger | No | `X-API-Key` from env |
| Invoice Reconciliation Engine | Disabled future placeholder; no outbound calls until contract verified | No | API key only after verification |
| AWS/Azure/GCP | MVP imports exported files/fixtures; optional live adapters later | No direct MVP dependency | tenant-supplied secrets only when enabled |

## Environment Variables

See `.env.example` for the authoritative list. Key groups: app/server, PostgreSQL, Redis, local object storage, tenant/auth, import/pricing/forecast/optimizer, reports/approvals, optional adapters, observability, CORS.

## Commands

| Action | Command |
|--------|---------|
| Install dependencies | `npm install` |
| Check Zig toolchain | `zig version` (must be 0.14) |
| Start infra | `docker compose up -d postgres redis` |
| Stop infra | `docker compose down` |
| Check infra | `docker compose ps postgres redis` |
| Run migrations | `npm run db:migrate` |
| First-run setup | `npm run setup` |
| Dev API/UI server | `npm run dev` |
| Dev worker | `npm run worker:dev` |
| Unit tests | `npm run test` |
| Zig tests | `zig build test` |
| Integration tests | `npm run test:integration` |
| E2E tests | `npm run test:e2e` |
| Full test gate | `npm run test && zig build test && npm run test:integration && npm run test:e2e` |
| Lint | `npm run lint` |
| Format | `npm run format` |
| Typecheck/build | `npm run build` |
| Golden fixtures | `npm run fixtures:golden` |
| Optimizer benchmark | `npm run bench:optimizer` |

## Product Constraints

- Core optimizer must run standalone with optional ecosystem integrations disabled.
- Never flatten forecast uncertainty into a single average for sizing decisions.
- Recommendation reports, approval packets, and notifications render from immutable snapshots, not live recomputation.
- Invoice Reconciliation remains disabled until `INVOICE_RECON_CONTRACT_VERIFIED=true` and an exact endpoint contract exists.
- UI must support dense desktop planning plus mobile dashboard/approval triage.
