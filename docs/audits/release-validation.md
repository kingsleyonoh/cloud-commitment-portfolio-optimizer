# Release validation receipt

Validated locally on 2026-08-26 against the canonical PRD and the Phase 0–3 progress ledger. No production account, paid resource, live provider credential, external Notification Hub, or Workflow Engine endpoint was contacted.

## Required gates

| Gate | Evidence |
| --- | --- |
| Toolchain | `npm run check:toolchain` passed with Node.js 24.15.0 and Zig 0.14.1. |
| Setup and migration contract | `npm run test:setup` passed: 99/99. Current migration chain is validated through migration 0025. |
| Unit and contract regression | `npm test` passed: 72 files, 285 tests. |
| Zig economic kernel | `zig build test` passed. |
| Golden economic fixtures | `npm run fixtures:golden` passed for 5 implemented fixtures with exact expected outputs. |
| Integration regression | `npm run test:integration` passed across all 16 shards: 875 tests total. |
| Browser E2E | `npm run test:e2e` passed: 13/13, including first-run import, forecast, optimizer, approval/report flow, health, and script-free landing. |
| Type and style | `npm run typecheck`, `npm run lint`, and `npm run format:check` passed. |
| Production build | `npm run build` passed with the application, worker, migrations, templates, and fixtures in the build graph. |
| Secret scan | `scripts/scan-secrets.ps1 -Mode all` passed clean across 743 files. |
| Dependency audit | `npm audit --audit-level=moderate` passed with 0 vulnerabilities. |
| Performance | `npm run bench:optimizer` passed: 1,000,000 replay line items / 12 months in 383.38ms; optimizer p95 63.51ms for 10,000 candidates and 25 iterations. Both are below the PRD limits of 60 seconds and 30 seconds. |

## Release boundary

The local/testable product is complete and release-ready for an operator-controlled deployment: imports, provider-aware pricing, forecasting, optimization, replay, approvals, report snapshots, audit logs, notifications, optional ecosystem adapters, observability, self-host deployment, and the landing/product overview are covered by implementation and tests.

The remaining external gate is operational only. Invoice Reconciliation stays disabled with `ENDPOINT_CONTRACT_UNVERIFIED` until its exact endpoint contract is verified. Live cloud credentials and optional external service endpoints must be supplied and explicitly enabled by the operator; publishing, deployment, DNS changes, and live integration enablement were intentionally not performed.
