# Core Config Loading

## What it establishes

`core/shared/config.ts` is the project-wide environment configuration boundary for API, worker, scripts, and future domain modules.

## Files

- `core/shared/config.ts` — parses documented PRD §14 environment variables into typed settings with safe local defaults.
- `tests/unit/config.test.ts` — verifies local defaults and invalid env rejection.
- `.env.example` and `.env.local.example` — document safe placeholder values for local setup.

## When to read this

Before writing code that:
- Reads environment variables directly.
- Adds a new required runtime configuration value.
- Enables an optional integration, object storage mode, queue setting, optimizer knob, or observability sink.

## Contract

- Use `loadConfig()` or `loadConfigFromEnv()` instead of reading `process.env` inside application code.
- Optional integration secrets stay blank in examples and must be read from environment at runtime.
- `DATABASE_URL` examples use `${POSTGRES_USER}` / `${POSTGRES_PASSWORD}` placeholders so no concrete credential-shaped URL is committed.
- Add new PRD-backed variables to `.env.example`, the parser, and tests in the same change.

## Cross-references

- PRD §14 Environment Variables: `docs/cloud-commitment-portfolio-optimizer_prd.md`
- Domain secrets rule: `.agent/rules/CODING_STANDARDS_DOMAIN.md`
