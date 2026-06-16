# Cloud Commitment Portfolio Optimizer — Coding Standards

These rules are always active. Load the specialized rule files when touching their surface: meta/skills, testing, E2E, live integration, and domain/production.

## Project Priorities

- Build exactly the PRD scope: a tenant-scoped FinOps optimizer for cloud commitments.
- Optimize for replayable economics, tenant isolation, auditability, deterministic tests, and clear CFO-facing explanations.
- Core product must work with ecosystem integrations disabled.
- Use TypeScript/Fastify/HTMX/Tailwind for API/UI/worker glue and Zig 0.14 for deterministic optimizer/replay kernels.

## No Scope Creep

- Only implement what is requested or what is next in `docs/progress.md`.
- Do not add features, abstractions, integrations, or helpers that are not in the PRD or current task.
- Invoice Reconciliation is a disabled future placeholder. Do not invent or call endpoints until a verified contract exists.

## Search and Read Before Writing

- Before creating a file/function/class/utility, search for an existing implementation and reuse it when possible.
- Read the relevant PRD section, `CODEBASE_CONTEXT.md`, and any touched source/tests before editing.
- For broad or safety-sensitive work, read the full file you will substantially rewrite.

## No Placeholder or Fake Implementation

- Never leave `TODO`, `pass`, `...`, `NotImplementedError`, stub returns, or fake placeholder routes as final code.
- Do not hardcode values to make tests pass. If schema/config/API data is missing, extend the real source of truth or escalate.
- Wire it or delete it: new routes, handlers, workers, utilities, templates, and migrations must be connected to the production path in the same change.

## Dependencies and APIs

- Never import a package not declared in `package.json`, Zig manifests, or the relevant dependency file.
- Verify external library methods against installed versions or docs before use.
- Do not hallucinate provider APIs. MVP cloud billing input is exported files/fixtures unless the PRD explicitly enables a live adapter.

## Data and Tenant Safety

- Every repository/query/job/report path touching tenant data must receive and enforce `tenant_id`.
- Cross-tenant IDs should return 404/403 without leaking whether the resource exists.
- Config-driven surfaces such as reports, notification templates, approval packets, emails, PDFs, and legal/tenant identity copy must render from immutable snapshots with strict undefined handling.

## Error Handling

- Never swallow errors silently. Catch blocks must log structured context, rethrow, or return a typed/domain error.
- Client responses use the project error shape: `{ error: { code, message, details } }`.
- Do not leak stack traces, API keys, DB URLs, raw provider secrets, or cross-tenant identifiers.

## Code Organization

- Keep entry points thin: validate input, resolve tenant/auth, call domain/service code, format response.
- Domain modules live under `core/*`; apps import domain modules, but domain modules must not import API/web entry points.
- Shared primitives belong in `core/shared` and must not be duplicated.
- Respect file limits: max 800 lines per source/test file, 50 lines per function, 200 lines per class. Split before files become mixed-responsibility.

## Naming and Style

- TypeScript files: kebab-case or existing local convention; functions `camelCase`; classes/types `PascalCase`; constants `UPPER_SNAKE_CASE`.
- Zig code follows idiomatic Zig naming and keeps numerical kernel functions deterministic and testable.
- Use structured JSON logs in server/worker code with `tenant_id`, `request_id`/`job_id`, module, status, duration, and error code where applicable.

## Git and Workflow Hygiene

- Do not run git commit, push, remote, or destructive git operations unless explicitly asked.
- Never use `git add -f`; ignored files are ignored intentionally.
- Proprietary workflow files and PRDs may be tracked during dev but must be stripped before public release via the established workflow.
- After completing a workflow, consult `.agent/workflows/PIPELINE.md` and suggest the next logical workflow.

## Append-Only Knowledge Ban

- Do not grow unbounded knowledge tables. New pattern/gotcha/module/foundation/check/build-journal entries get one file per item in the relevant `.agent/knowledge/*` or `docs/build-journal/` directory.
- `CODING_STANDARDS*.md`, `CODEBASE_CONTEXT.md`, workflow stubs, and bounded context/command/env tables are exempt.

## Verification Claims

- Do not say tests pass unless you ran them and can cite the command/output.
- Do not say a change follows the PRD unless you read the relevant PRD section in this session.
- Prefer concrete evidence: changed file path, command output, test output, or generated artifact.
