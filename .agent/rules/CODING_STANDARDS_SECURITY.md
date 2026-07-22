# Cloud Commitment Portfolio Optimizer — Coding Standards: Security & Production

> Deployment, secrets, environment, and production-readiness rules split from `CODING_STANDARDS_DOMAIN.md` to keep every bounded rules file under 10,000 characters.

## Deployment Flow (Dev → Production)

### Dev Branch Workflow
1. All implementation work happens on `dev` branch
2. Tests run against local services (local PostgreSQL 16, local Redis 7, local DuckDB temp storage, local filesystem object storage)
3. Each completed item → commit → push to `dev`
4. Run full test suite frequently

### When Ready to Deploy
1. Ensure ALL tests pass on `dev`
2. Merge `dev` → `main`
3. Push `main` → triggers deployment pipeline
4. Run migrations against production database
5. Verify deployment in production

### Emergency Hotfix Flow
- Branch from `main` → `hotfix/description`
- Fix + test → merge to BOTH `main` and `dev`
- Use `/hotfix` workflow for guidance

## Security Rules

### Secrets Management (Hardcoded Secrets Banned — CRITICAL)
- **NEVER hardcode** real API keys, tokens, passwords, JWTs, OAuth secrets, signing keys, DB passwords, or webhook secrets as string literals in ANY tracked file. This includes `.yolo/`, `docs/`, `scripts/`, `tests/`, `fixtures/`, `migrations/`, and deployment configs.
- ⛔ **Most `.yolo/` audit artifacts, `docs/build-journal/`, and `docs/yolo-inbox.md` are TRACKED DURING DEV** (`.gitignore` `⚠️ TRACKED DURING DEV` banner). Files there commit to git history on every YOLO push. Treat them as if they were in `src/` for secret-handling. Exception: local operational runtime paths such as `.yolo/logs/`, `.yolo/events/`, `.yolo/worktrees/`, and `.yolo/incidents/` are gitignored/untracked.
- **Required pattern:** read from env (`os.environ['X']`, `process.env.X`, `${VAR}`, `getenv('X')`) or vault. Document the env var in `.env.example` with a placeholder like `your-key-here`. **docker-compose.prod.yml is git-tracked** — use `${VAR}` references, NEVER inline passwords. Create `.env` on the server for secrets.
- **`.env` files** stay LOCAL and gitignored (`.env.local`, `.env.production`). Only `.env.example` is committed.
- Use environment variables in production (Railway / Vercel / Fly / GitHub Actions secrets / etc.).
- **Pre-commit scanner:** `scripts/scan-secrets.ps1` (PowerShell) and `scripts/scan-secrets.sh` (Bash) ship in every project. Manual audit: `pwsh scripts/scan-secrets.ps1 -Mode tracked` (full repo) or `-Mode staged` (staged-only). Exit 0 = clean, exit 1 = matches found (JSON report on stdout).
- **Detection patterns** (canonical source — `scripts/scan-secrets.ps1`): JWT-shape (`eyJ...`); provider prefixes (`sk_live_`, `sk_test_`, `pk_live_`, `pk_test_`, `sk-` for OpenAI, `sk-ant-` for Anthropic, `ghp_` / `gho_` / `github_pat_` for GitHub, `xoxb-` / `xoxp-` for Slack, `glpat-` for GitLab, `AKIA` / `ASIA` for AWS, `AIza` for Google); 32+ char hex / 40+ char base64 / 30+ char alphanumeric strings adjacent to `api_key` / `secret` / `token` / `password` / `auth` / `client_secret` keywords; database URLs with embedded credentials.
- **Allow-listed placeholders** (scanner permits): `${VAR}`, `${{VAR}}`, `{{TOKEN}}`, `<REDACTED>`, `<your-api-key>`, `your-key-here`, `example_key`, `sample_token`, `placeholder`, `redacted`, `fake_key`, `dummy_key`; ellipsis-truncated values (`eyJ...truncated`); lines containing `os.environ` / `process.env` / `getenv(` / `config.get(`.
- **AI/Mesh enforcement layers:** (1) inspect the implementation plan for hardcoded-secret intent; (2) run the tracked/staged scanner before commit or push; (3) scan relevant uncommitted files at close-out. Any match escalates immediately—no automatic retry, because potential leakage requires human-driven rotation. Runtime v2 reports literal process facts only and does not semantically accept scanner output.
- **`/prepare-public` Step 0** runs the scanner over every tracked file before public release. Last line of defense.
- **Rejected justifications** (always invalid — see Section 11 for the full catalogue): "it's a dev key", "it's a one-shot script", "I'll scrub before pushing", "lint-staged catches it", "`.yolo/` is private", "tests need a real value", "I'll fix it next batch".
- **If a secret leaks:** rotate the credential at the issuer FIRST (assume compromised — it's in shell history, agent memory, system snapshots), update `.env` / vault SECOND, replace the literal with an env-var read THIRD, `git filter-repo --invert-paths --path <file>` to remove from history FOURTH, force-push LAST. Scrubbing alone does NOT remove the secret from history.
- **Never bypass.** No `git commit --no-verify` to skip the scanner. No deleting the scanner invocation from the workflow. No committing with the secret to "fix later". A secret that ships to git history once is compromised forever.

### Input Validation
- Validate ALL user input at the boundary (API route, form handler)
- Use framework validators (Pydantic, Zod, Django Forms)
- Never trust client-side validation alone

### Authentication & Authorization
- Verify auth on EVERY protected endpoint
- Check permissions, not just authentication
- Log auth failures

### SQL & Data Safety
- Use parameterized queries or ORM methods — NEVER string concatenation for SQL
- Sanitize HTML output to prevent XSS
- Validate file upload types and sizes

### Multi-Tenant Config-Driven Surfaces (CRITICAL — Prevents Cross-Tenant Leakage)

If PRD §2 mandates `tenant_id`, these surfaces MUST NEVER contain hardcoded per-tenant literals: document templates (invoices, quotes, contracts, legal boilerplate), transactional emails, PDF/printable artifacts, admin UI copy naming "the operator", API responses echoing tenant identity.

**Banned:** legal entity names as HTML literals, registration/license/tax numbers as constants, addresses inlined into templates, contact email/phone as constants, logo/wordmark paths for one specific tenant, disclaimer text naming a specific regulator or entity.

**Required pattern — Template Context API:**

Every config-driven surface renders against an **immutable snapshot** captured at generation time (not a live lookup — re-renders MUST use the snapshot for legal/audit accuracy). Snapshot shape lives in PRD §5 (emitting module); backing columns in PRD §4 Tenant Identity Columns.

- Extend schema BEFORE writing the template. Never write a token whose backing field doesn't exist.
- Turn ON strict undefined handling: Handlebars `strict: true`, Jinja2 `StrictUndefined`, equivalent. Missing tokens MUST throw, not silently emit `""`.

**Test contract:**

- Template tests MUST load ≥2 tenants and assert Tenant A's render excludes any Tenant B literal. See `CODING_STANDARDS_TESTING_LOGIC.md` — Multi-Tenant Fixtures Mandatory.
- `validate-prd` and `security-audit` grep template directories for tenant literals. Matches = `TENANT_IDENTITY_LEAK`.

**If you hit a missing field:** apply "No Silent Workarounds" (`CODING_STANDARDS.md`). Escalate for schema extension. Do not hardcode.

## Environment Variables
- `.env` for local development (NEVER committed)
- `.env.example` for documenting required vars (committed, no real values)
- Production variables set via hosting platform UI/CLI
- NEVER log env var values

## Production-Readiness Rules (Before Merge to Main)

Before merging ANY feature to `main`:

1. **All tests pass** — run the project's available canonical aggregate (`npm run test:all` here) and require 0 failures
2. **No console.log / print debugging** — remove all debug output
3. **No TODO/FIXME/HACK** — resolve them or create tickets
4. **Error handling exists** — no unhandled exceptions in user flows
5. **Types are complete** — no `any` / `Any` types in TypeScript/Python typed code
6. **Migrations are committed** — all DB changes have migration files
7. **Environment variables documented** — new ones added to `.env.example`
8. **Linting passes** — code matches project style rules
