# E2E HTTP/Browser Harness Module

## Purpose

Starts and owns deterministic fixture HTTP processes for real Chromium navigation, readiness, collision, failure, timeout, and exact-child cleanup tests.

## Key files

- `tests/e2e/helpers/server.ts` — public server-test helper.
- `tests/e2e/helpers/server-process.ts` — child-process ownership.
- `tests/e2e/helpers/server-readiness.ts` — bounded readiness checks.
- `tests/e2e/http-browser.spec.ts` — real Chromium navigation.
- `tests/e2e/server-lifecycle.spec.ts` — lifecycle failure/cleanup coverage.

## Dependencies

- Upstream: Playwright and Node process/network APIs.
- Downstream: future reachable app journeys after Phase 1 supplies application entrypoints.

## Tests

- `npm run test:e2e`

## Cross-references

- `playwright.config.ts`
