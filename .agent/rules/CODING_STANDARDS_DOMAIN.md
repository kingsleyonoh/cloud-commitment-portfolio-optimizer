# Cloud Commitment Portfolio Optimizer — Coding Standards: Domain & Production

Load this when touching auth, tenancy, data, security, env, deployment, reports, adapters, workers, or production readiness.

## Local Services and Deployment Flow

- Development tests run against local PostgreSQL, local Redis, DuckDB, and local filesystem object storage.
- `docker compose up -d postgres redis` starts required network services before migrations/integration tests.
- DuckDB is an embedded analytical dependency; keep temp files under `DUCKDB_TEMP_DIR` and clean worker-owned artifacts.
- Production uses containers with PostgreSQL, Redis, persistent object storage/S3-compatible storage, and separate worker process types.

## Secrets Management

- Never hardcode real API keys, tokens, passwords, JWTs, signing keys, cloud credentials, DB URLs with credentials, or webhook secrets in tracked files.
- Read secrets from env/host secret manager only. `.env` stays local and ignored; `.env.example` contains names and safe placeholders only.
- Optional adapter keys (`NOTIFICATION_HUB_API_KEY`, `WORKFLOW_ENGINE_API_KEY`, future `INVOICE_RECON_API_KEY`) must never be logged or stored in plaintext.
- Run `scripts/scan-secrets.ps1` or `scripts/scan-secrets.sh` before release-sensitive changes.

## Tenant and Authorization Rules

- Every data-bearing table except `tenants` must include `tenant_id` and tenant-leading indexes.
- Every API route, UI route, worker job, report renderer, notification emitter, and adapter event must operate inside resolved tenant context.
- Authorization uses explicit role/resource actions from the PRD matrix. Hidden UI buttons are not authorization; enforce in API/service policy.
- Cross-tenant resource IDs must not reveal existence. Prefer 404 for scoped lookups and 403 for known denied actions.

## Economic Correctness Rules

- Recommendations optimize risk-bounded net savings after unused waste, amortization, liquidity penalties, downside loss, and policy constraints.
- Monetary values use integer cents; displayed percentages are rounded per PRD economic-kernel contract.
- Optimizer runs must freeze provider, instrument, price table version IDs, forecast run, policy, scenario, random seed, and input snapshot URI before queueing.
- Forecast distributions must travel into optimizer risk. Do not size commitments from a single average forecast.
- Backtests must use only data available at the historical decision date. Future leakage is a correctness bug.

## Reports, Approvals, Notifications

- Reports and approvals render from immutable `report_snapshots.snapshot_json` or `approvals.approval_snapshot`, never live DB recomputation.
- Enable strict undefined handling in templates. Missing template tokens fail rendering and mark the report/notification appropriately.
- Tenant identity literals, legal names, addresses, tax IDs, contacts, and wordmarks must come from snapshot data, not hardcoded templates.
- Local in-app notifications are canonical. Notification Hub is an optional mirror.

## Adapter Boundaries

- Notification Hub and Workflow Engine are optional. Disabled adapters must leave core import/forecast/optimizer/approval/report flows successful.
- Adapter calls enqueue `ecosystem_events` with idempotent event IDs and retry/backoff behavior.
- Invoice Reconciliation is disabled future scope. If enabled without verified contract, startup/config validation must fail safe and make zero outbound calls.

## Input, Upload, and SQL Safety

- Validate all API bodies, query params, file metadata, and form posts at the boundary with explicit schemas.
- Validate upload size, source, format, checksum, and parser contract before ingesting billing exports.
- Use parameterized SQL/query builders only. No string-concatenated SQL.
- Sanitize HTML output and template data to prevent XSS in HTMX views and reports.

## Production Readiness Before Main/Release

- Full gate passes: TypeScript tests, Zig tests, integration tests, E2E tests, lint, build, migrations, and secret scan.
- No debug prints/console spam, unresolved TODO/FIXME/HACK, unwired code, or undocumented env vars.
- Migrations are committed and idempotent; deployment runs migrations before app startup.
- `/health`, `/health/db`, and `/health/ready` reflect process, PostgreSQL, Redis, migrations, worker queue, and object storage readiness.

## Performance and Observability

- Log structured JSON with tenant/job/request context and no sensitive data.
- Use Redis caching only for versioned or tenant-scoped summaries; key by tenant and version/checksum.
- Watch compound load on pages/endpoints with 3+ backend calls.
- Meet PRD targets: API list/detail p95 < 250ms excluding queued jobs, optimizer p95 < 30s, 12-month replay < 60s for 1M line items, queue lag < 2 min normal load.
