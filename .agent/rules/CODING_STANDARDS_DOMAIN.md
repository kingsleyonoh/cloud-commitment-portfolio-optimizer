# Cloud Commitment Portfolio Optimizer — Coding Standards: Domain & Production

> Domain organization, performance, and Cloud Commitment rules. Security/deployment/production gates live in `CODING_STANDARDS_SECURITY.md`.

## Code Organization Conventions

### Import Order
1. Standard library imports
2. Third-party package imports
3. Local/project imports
4. Blank line between each group

### Naming Conventions
- **Files:** `snake_case.py` / `kebab-case.ts` (follow project convention)
- **Classes:** `PascalCase`
- **Functions/Methods:** `snake_case` (Python) / `camelCase` (JS/TS)
- **Constants:** `UPPER_SNAKE_CASE`
- **Private:** Prefix with `_` (Python)

### Project Structure
- Follow the structure defined in `CODEBASE_CONTEXT.md`
- New modules go in the documented location for that type
- If unsure where something belongs, check `CODEBASE_CONTEXT.md` or ask

## Logging Standards
- Use structured logging (JSON format in production)
- Log levels: DEBUG (dev only), INFO (normal events), WARNING (recoverable), ERROR (failures), CRITICAL (system down)
- Include context: user_id, request_id, module name
- NEVER log sensitive data (passwords, tokens, PII)

## Error Response Standards
- Consistent error format across all endpoints
- Include: error code, human-readable message, timestamp
- Never leak stack traces to clients in production
- Log full error details server-side

## Server-Side Performance Rules

### Deduplicate Expensive Calls
If multiple functions on the same request path call the same expensive operation (auth check, config fetch, external API), extract it into a shared cached helper (e.g., request-scoped cache, singleton per request). Never let each function create its own call — N actions × M calls = latency multiplication.

### Parallel by Default
Independent operations (DB queries, API calls, file reads) MUST run concurrently (`Promise.all`, `asyncio.gather`, goroutines, etc.). Sequential execution is only for data-dependent chains where one result feeds the next.

### Wire It or Delete It (ENFORCED)
If you create a utility, middleware, handler, route, or service file, connect it to the framework entry point **in the same commit**. Unwired code creates false confidence — the feature "exists" but doesn't execute.

**This means:**
- New route handler → add it to the router in the same commit
- New middleware → add it to the middleware chain in the same commit
- New database query function → call it from a route/handler in the same commit
- New event consumer → register it with the event bus in the same commit
- New utility module → import and use it from the calling code in the same commit

If a function has no caller, a route has no handler, or a middleware is defined but not applied — it is dead code regardless of whether tests pass.

### Compound Load Audit
After implementing 5+ operations callable from a single entry point (page render, API endpoint, CLI command), audit total I/O calls. Features built incrementally work in isolation but compound into latency regressions that correctness tests never catch.

### Prefer Joins Over Multiple Queries
If the ORM/DB supports joins or eager loading, use them. N separate queries for N related tables is a sequential waterfall — one joined query is one round-trip. This includes any pattern where you fetch IDs from one table then loop to fetch details from another.

### Pin Compute to Data Region
Serverless functions must run in the same region as the database. Unmatched regions add 50-100ms per query. Set this in deployment config (vercel.json, fly.toml, etc.) during Phase 0 setup — not after performance problems surface.

## Code Structure Rules

### Thin Entry Points
Route handlers, server actions, CLI commands, and event handlers must stay thin — validate input, call a service/domain function, format the response. Extract business logic, side effects (notifications, logging, external calls), and data access into a separate layer. Entry points that mix multiple concerns become unmaintainable and untestable.

### Single State Mechanism Per Feature
Multi-step flows (wizards, forms, onboarding) must use ONE state management approach. Mixing persistence mechanisms (e.g., browser storage + in-memory cache + framework state + background sync) creates maintenance burden and race conditions. Pick one, stick with it.

### Modularity Awareness
Before adding code to any file, assess its current structure. Files should have a single clear responsibility. When a file's scope grows to cover multiple concerns, split by responsibility into separate modules — don't wait for a modularity audit. The project's limits (250 lines/file, 40 lines/function, 180 lines/class from `/check-modularity`) are guardrails, not targets.

## Cloud Commitment Domain Rules

- Preserve tenant scope through every economic artifact: imports, forecasts, optimizer runs, recommendations, approvals, reports, notifications, and ecosystem events.
- Recommendation economics must use frozen price-table versions, forecast outputs, optimizer policy, random seed, and scenario inputs; do not recompute from live mutable rows for report/approval rendering.
- Optimizer calculations use integer cents and deterministic Zig golden fixtures for every supported instrument/provider cell.
- Optional ecosystem adapters are mirrors/triggers only; local recommendation, approval, report, and notification state remains canonical.
- Invoice Reconciliation remains disabled until an exact endpoint contract is verified; config enabling without verification must fail safe with zero outbound HTTP.
