# Cloud Commitment Portfolio Optimizer — Coding Standards: Live, Integration, and Frontend Testing

Load this when tests touch local services, API integration, HTMX UI routes, React components/islands, workers, queues, or file storage.

## Mock Policy: Do Not Mock What We Own

Test against real local services whenever possible:

- PostgreSQL 16 for schema, indexes, constraints, migrations, and tenant-scoped queries.
- Redis 7 for queues, locks, retries, and cache behavior.
- DuckDB for analytical replay/import pipelines.
- Local filesystem object storage for imports, forecast outputs, reports, and frontier artifacts.
- Fastify routes through the real app registration path.

Mock only third-party or irreversible/rate-limited services: live cloud provider APIs, email/SMS delivery, external Notification Hub/Workflow Engine HTTP calls, and future Invoice Reconciliation calls. Prefer recorded fixtures and explicit adapter-disabled tests.

## Integration Test Expectations

- Start services with `docker compose up -d postgres redis` before DB/queue tests.
- Apply real migrations in order; do not use simplified schemas.
- Use test transactions, dedicated schemas, or cleanup helpers to isolate test data.
- Queue/worker tests must exercise real job payloads and persisted deferred-work columns.
- File/object tests must read/write through the production `objectStore` abstraction.

## API Integration Testing

- Test route registration, validation, auth middleware, tenant context, handler, service call, persistence, and response serialization together.
- Use Fastify `inject()` or the project-approved in-process test client for fast integration tests; real HTTP is covered by E2E rules.
- Assert pagination/filtering, rate-limit/error headers where applicable, and the standard error shape.

## HTMX UI Testing

- Server-rendered HTMX pages must test returned HTML fragments, form validation messages, swap targets, permission-gated actions, empty/loading/error states, and progressive enhancement.
- Use semantic selectors and visible text. Avoid asserting Tailwind class internals unless the class is a design-system contract.
- Keep chart data accessible via tables/CSV equivalents and test those alternatives.

## React Component / Island Testing

If React is used for interactive islands or heavier chart/frontier widgets, test with React Testing Library + Vitest/jsdom.

- Prefer queries in order: `getByRole`, `getByLabelText`, `getByText`, `getByPlaceholderText`, then `getByTestId` only as a last resort.
- Use `userEvent`, `screen`, `within`, and `waitFor`; avoid implementation-detail state assertions and snapshots.
- Every interactive React component needs at least one happy-path interaction test and one error/edge test.
- Do not test styling via brittle class assertions; test accessible names, content, state, and callbacks.

## Worker and Adapter Tests

- Workers must test queued, processing, completed, failed/quarantined/retrying/cancelled states with real persisted payloads.
- Adapter-disabled tests are mandatory: core state must complete when Notification Hub and Workflow Engine are disabled.
- External adapter HTTP may be mocked/recorded, but local enqueue/retry/idempotency state must use real DB/Redis.
- Invoice Reconciliation tests must assert no production outbound calls while contract is unverified.

## Cleanup

- Every test creates unique tenant/account IDs and cleans after itself.
- Kill worker/server processes and close DB/Redis/DuckDB handles after tests.
- Do not leave files in `.data`, `.tmp`, or report/import temp paths unless the test explicitly snapshots them.
