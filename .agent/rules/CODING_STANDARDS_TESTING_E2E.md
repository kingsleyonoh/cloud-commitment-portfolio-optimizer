# Cloud Commitment Portfolio Optimizer — Coding Standards: E2E Testing

Load this when endpoints, pages, user journeys, auth, deployment readiness, or browser behavior are touched.

## E2E Scope

E2E tests hit a running server over real HTTP and, for UI paths, a real browser via Playwright. They prove startup, port binding, middleware order, CORS, sessions/API keys, local PostgreSQL/Redis readiness, HTMX behavior, and serialization.

## When E2E Is Required

- Any new/changed API endpoint: add or update real-HTTP E2E coverage.
- Any new/changed interactive page, approval flow, upload flow, dashboard, report, chart, or form: add Playwright coverage.
- Pure utilities/config with no endpoint/UI impact may skip E2E with `SKIPPED_NO_ENDPOINTS` or an equivalent concrete note.
- If E2E tooling is not scaffolded yet, report `E2E_NOT_CONFIGURED`; do not pretend integration tests are E2E.

## Test Architecture

1. Start local PostgreSQL and Redis with Docker Compose.
2. Apply all production migrations.
3. Start the actual Fastify/HTMX app via `npm run dev` or the project E2E server command.
4. Wait for `/health/ready`.
5. Use HTTP clients or Playwright to exercise real routes.
6. Clean test data and stop server/processes reliably.

## Required Journeys

- First-run setup → default tenant/API key → login/API auth.
- Import synthetic/AWS fixture → quarantine invalid upload.
- Price fixture activation → forecast run → optimizer run → recommendation detail/report.
- Finance approval review/approve/reject on desktop and mobile.
- Backtest run and report export.
- Optional adapters disabled: core flow succeeds and integration status explains disabled state.

## UI Viewports

Test at minimum:

- Desktop: 1440px wide for dense tables/frontier charts.
- Tablet: 1024px with filters/drawers and horizontal chart behavior.
- Mobile: 390px approval review, dashboard triage, and accessible 44px tap targets.

## E2E Quality Rules

- Prefer role/label/text locators; avoid brittle CSS selectors except stable IDs/test IDs.
- Assert visible business outcomes: recommendation risk/downside, approval status, import state, permission denial, report snapshot identity.
- Include unhappy paths: invalid auth, wrong role, cross-tenant resource, invalid upload, missing price table, infeasible optimizer.
- Capture screenshots/traces on failures for UI flows.
- Test env must approximate production: same migrations, service versions, env-var loading, storage paths, and OS binaries used for report rendering/browser tasks.

## Skip Honesty

Rejected skip reasons: “covered by integration tests,” “infra required,” “deferred,” or “not needed.” Valid skips must identify no server/no endpoint/no configured E2E framework and include the remediation.
