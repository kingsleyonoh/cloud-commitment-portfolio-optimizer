# Cloud Commitment Portfolio Optimizer — Codebase Context

Last updated: 2026-08-25
Template synced: 2026-07-14
PRD: `docs/cloud-commitment-portfolio-optimizer_prd.md`
Status: Phase 0 is evidence-closed and Phase 1 is active. The standalone session API now includes local-password login, no-`kid` RS256 access-cookie issuance, stable-family refresh rotation/reuse revocation, logout, endpoint-specific cookie/Origin/Fetch/CSRF selection, Redis abuse controls, and authenticated cloud-account management while preserving bearer/API-key contracts. `/login` HTML/HTMX and Phase 3 deployment/production readiness remain deferred.

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

| Purpose | Command | Availability / owner |
|---|---|---|
| Install dependencies | `npm install` | Available now |
| Check Zig toolchain | `zig version` (project pin: 0.14.1) | Available now |
| Start infra | `docker compose up -d postgres redis` | Available now |
| Stop infra | `docker compose down` | Available now |
| Check infra | `docker compose ps` | Available now |
| Run migrations | `npm run db:migrate` | Phase 0 command shell available; canonical migrations are Phase 1-owned |
| First-run setup / seed | `npm run setup` | Phase 0 command shell available; usable tenant/product seed is Phase 1-owned |
| Setup/config tests | `npm run test:setup` | Available now |
| Run tests (unit only) | `npm run test` | Available now |
| Run tests (integration only) | `npm run test:integration` | Available now; requires owned local services |
| Run E2E tests | `npm run test:e2e` | Available now; current fixture HTTP/browser harness only |
| Run Zig tests | `zig build test` | Available now; domain golden corpus remains Phase 1-owned |
| Run full aggregate | `npm run test:all` | Available now; setup + unit + Zig + integration + E2E |
| Typecheck | `npm run typecheck` | Available now |
| Dev API/UI server | `npm run dev` | Planned — Phase 1 App/Infra Skeleton; script absent today |
| Dev worker | `npm run worker:dev` | Planned — Phase 1 App/Infra Skeleton; script absent today |
| Lint | `npm run lint` | Planned — Phase 1 App/Infra Skeleton; script absent today |
| Format | `npm run format` | Planned — Phase 1 App/Infra Skeleton; script absent today |
| Production build | `npm run build` | Planned — Phase 1 App/Infra Skeleton; script absent today |
| Golden fixtures | `npm run fixtures:golden` | Planned — Phase 1 Zig economic-kernel slice; script absent today |
| Benchmark | `npm run bench:optimizer` | Planned — Phase 3 performance hardening; script absent today |

## Project Structure

| Path | Purpose | State |
|---|---|---|
| `core/config/` | Typed Phase 0 configuration/deployment declarations | Current |
| `core/db/` | Migration/setup command shell and deterministic SQL planning | Current; canonical migrations are Phase 1-owned |
| `core/shared/` | `dbPool`, `jobQueue`, `objectStore`, `duckdbAnalytics`, logger, errors | Current Phase 0 foundation |
| `tests/` | Setup, unit, integration, E2E harness, and fixtures | Current; product/golden coverage grows with owning phases |
| `apps/api/` | Fastify API, auth middleware, REST routes | Current for health, registration, auth/session, tenant profile, users, API-key metadata/rotation, and cloud-account management |
| `apps/web/` | HTMX server-rendered UI templates/routes | Planned — Phase 1 |
| `apps/worker/` | Queue consumers invoking Zig optimizer/replay binaries | Planned — Phase 1 |
| `core/tenant/` | Tenant context, RBAC policy, API key hashing, users, sessions, cloud-account services | Current Phase 1 foundation plus first product endpoint |
| `core/imports/` | Provider parsers and canonical usage normalization | Planned — Phase 1 |
| `core/pricing/` | Price table validation and instrument models | Planned — Phase 1 |
| `core/forecasting/` | Forecast models and scenario generation | Planned — Phase 1 |
| `core/optimizer/` | Zig optimizer source, solver bindings, efficient frontier logic | Planned — Phase 1 |
| `core/replay/` | Deterministic replay/backtest engine | Planned — Phase 2 |
| `core/approvals/` | Approval state machine and snapshots | Planned — Phase 2 |
| `core/reports/` | Strict report renderer and templates | Planned — Phase 1 |
| `core/notifications/` | In-app notifications and preferences | Planned — Phase 2 |
| `core/adapters/` | Optional Notification Hub, Workflow Engine, and disabled Invoice Recon adapters | Planned — Phase 2 |
| `db/migrations/` | Tenant-scoped PostgreSQL migrations | Current through accepted report snapshot migration `0020`; `cloud_accounts` API uses accepted `0009` schema |

## Knowledge Routing

Unbounded project knowledge is directory-per-kind only; do not recreate flat module, foundation, pattern, gotcha, or build-journal tables here.

| Kind | Canonical index |
|---|---|
| Current source modules | `.agent/knowledge/modules/_index.md` |
| Shared foundation primitives | `.agent/knowledge/foundation/_index.md` |
| Reusable project patterns | `.agent/knowledge/patterns/_index.md` |
| Project-specific gotchas | `.agent/knowledge/gotchas/_index.md` |
| Batch journals | `docs/build-journal/_index.md` |

## Tenant Model

Tenant-scoped by default. `tenants` is a credential-free metadata ownership root; login identities live in the separate `users` child and hashed, revocable API credentials live in the accepted six-column `api_keys` child. The additive nine-column `registration_requests` table is the pre-tenant digest-only idempotency ledger; accepted migrations remain unchanged, and the ledger never stores raw registration keys/bodies, credentials/hashes, success responses, or client IPs. Public registration defaults off; production is double-gated and fails startup without a healthy shared atomic limiter or explicitly trusted enforcing edge/proxy allowlist. The first committed 201 may return plaintext once; later success replay is a non-secret 409 and never recovers/reissues it. Every API key resolves through an unrevoked-key/active-tenant join as a fixed deny-by-default `finops_analyst` actor with no user identity and only the explicit PRD §2b automation allow-list; it can read/create/update cloud accounts and cannot administer users/keys/policies/settings/integrations, mutate price tables, deactivate accounts, read audit/approval queues, decide approvals, or elevate into an admin JWT. UI JWT claims are assertions only: RS256 verification is followed by an active user+tenant join and exact current database-role match before context is populated. Cookie-issued access JWTs add a stable family ID and session CSRF hash; opaque refresh rotation, replay revocation, inactivity, and logout serialize on the stable PostgreSQL family row. Tenant profiles expose neither users nor key material. Cloud-account APIs expose normalized provider/external-ref/display-name/currency/tags/is_active metadata with keyset pagination, optimistic concurrency, same-tenant uniqueness, Tenant Admin JWT-only deactivation, and non-enumerating 404s for foreign IDs. Optimizer data persists draft/ready scenarios, draft/active/archived policies, queued/running/terminal optimizer runs, and draft/ready/pending/applied/superseded/rejected recommendations with same-tenant forecast, scenario, policy, user, and frozen price-version ownership checks. Report snapshots persist immutable tenant-owned polymorphic report identity and snapshot JSON before any approval/report renderer mutates display artifacts. All BIGINT/cents JSON uses unsigned canonical decimal strings without `Number` coercion, every data-bearing child table includes `tenant_id`, and cross-tenant resource IDs return a non-enumerating 404.

## External Integrations

| System | Required? | Notes |
|---|---|---|
| Notification Hub | Optional | `POST /api/events`, health check, feature-flagged, core never depends on it |
| Workflow Automation Engine | Optional | Manual workflow execution for approval orchestration |
| Invoice Reconciliation Engine | Disabled future placeholder | No outbound calls until `INVOICE_RECON_CONTRACT_VERIFIED=true` with exact endpoint |
| AWS/Azure/GCP billing exports | Input data | MVP file/fixture imports; optional live adapters later |

## Deep References

| Surface | Path | State |
|---|---|---|
| Current configuration module | `core/config/` | Phase 0 current; see `.agent/knowledge/modules/core-config.md` |
| Current SQL command module | `core/db/` | Phase 0 current; see `.agent/knowledge/modules/core-db.md` |
| Current shared primitives | `core/shared/` | Phase 0 current; see `.agent/knowledge/modules/core-shared.md` and the foundation index |
| Current E2E harness | `tests/e2e/` | Phase 0 current; see `.agent/knowledge/modules/tests-e2e.md` |
| API routes | `apps/api/routes/` | Current for foundation/auth/tenant/user/API-key/cloud-account routes |
| HTMX views | `apps/web/views/` | Planned — Phase 1 |
| Workers | `apps/worker/` | Planned — Phase 1 |
| Tenant/RBAC | `core/tenant/` | Current for authentication, users, API keys, and cloud-account service/repository |
| Imports | `core/imports/` | Planned — Phase 1 |
| Pricing | `core/pricing/` | Planned — Phase 1 |
| Forecasting | `core/forecasting/` | Planned — Phase 1 |
| Optimizer | `core/optimizer/` | Planned — Phase 1 |
| Reports/templates | `core/reports/` | Planned — Phase 1 |
| Notifications | `core/notifications/` | Planned — Phase 2 |
| Adapters | `core/adapters/` | Planned — Phase 2 |
| Migrations | `db/migrations/` | Current additive product plan through `0020_create_report_snapshots.sql` |
| Domain golden fixtures | `tests/fixtures/economic_kernel/` | Planned — Phase 1 |

## Environment Variables

See `.env.example` for implemented config. Auth verification uses only `JWT_PUBLIC_KEY_PATH`; issuance separately loads `JWT_PRIVATE_KEY_PATH`, requires RSA ≥2048 and matching public SPKI, and emits exact no-`kid` RS256 headers. Production requires HTTPS `PUBLIC_BASE_URL`, `AUTH_LIMITER_MODE=redis`, `AUTH_COOKIE_SECURE=true`, and optional explicit immediate-proxy `AUTH_TRUSTED_PROXY_CIDRS`; loopback development/test may use unprefixed non-Secure cookies. Other categories: app, database/queue, tenant management, import/pricing/forecast/optimizer, reports/approvals, optional integrations, observability.
