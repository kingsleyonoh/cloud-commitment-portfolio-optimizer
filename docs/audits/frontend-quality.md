# Frontend release audit

The P3 frontend contract is satisfied by the current server-rendered surface:

- `MOBILE_VIEWPORT_PASS`: every screen emits a viewport declaration and responsive CSS; approval actions and dashboard triage retain 44px controls at the 390px target viewport.
- `PRIVACY_MATRIX_PASS`: import guidance warns about account IDs/tags, forbids credentials, and directs operators to redact support exports; optional adapters require explicit enablement.
- `BUNDLE_DYNAMIC_IMPORT_AUDIT_PASS`: the UI ships no dashboard JavaScript and no charting or Parquet-preview dependency. The table views are the accessible data alternatives, so there is no heavy bundle to eagerly load. Any future chart/preview package must be dynamically imported only from its owning screen.
- `FRONTEND_IMPECCABLE_AUDIT_PASS`: semantic headings/tables, skip links, labels, visible focus, reduced-motion CSS, explicit risk text, empty/error/quarantine/disabled states, and tenant-safe rendering are covered by source and integration tests.
- `FRONTEND_IMPECCABLE_POLISH_PASS`: the landing, dashboard, approval, audit, import, and settings surfaces use the shared sober financial control-room language and avoid color-only savings claims.

The executable checks are `tests/unit/frontend-quality-audit.test.ts`, `tests/unit/frontend-bundle-audit.test.ts`, `tests/integration/approvals-ui-route.test.ts`, `tests/integration/dashboard-route.test.ts`, and `tests/integration/imports-ui-route.test.ts`.
