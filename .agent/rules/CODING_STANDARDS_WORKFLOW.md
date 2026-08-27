# Cloud Commitment Portfolio Optimizer — Coding Standards: Workflow & Git

> Workflow pipeline, approval, routing, and Git rules split from `CODING_STANDARDS.md` to keep every bounded rules file under 10,000 characters.

## Workflow Pipeline Awareness
- After completing ANY workflow, **read `.agent/workflows/PIPELINE.md`** and suggest the NEXT logical workflow based on the current context.
- **PIPELINE.md is the single source of truth** for "what comes next." Individual workflows do NOT hardcode their next step — they defer to PIPELINE.md.
- Never leave the user guessing what to do next. Always end with a clear next step.
- **When creating a NEW workflow file**, ALWAYS add it to `PIPELINE.md` with its "When Done, Suggest" message.
- **When deleting a workflow file**, ALWAYS remove it from `PIPELINE.md`.
- `PIPELINE.md` must ALWAYS match the actual files in `.agent/workflows/`. If they're out of sync, fix `PIPELINE.md` immediately.

## Workflow Approval Gates (CRITICAL — Prevents Plan Mode Errors)
When a workflow step says "present to user", "wait for approval", or "approve before proceeding":
1. Present the content directly as **formatted text in the conversation**.
2. End with a clear question: `Approve? [yes / no / edit]`
3. Wait for the user's response before proceeding to the next step.
4. **NEVER call `ExitPlanMode` or `EnterPlanMode`** during workflow execution. These are Claude Code built-in tools for a separate system (toggled via `Shift+Tab`). Workflow approval gates are handled through direct conversation.
5. **NEVER write to `.claude/plans/`** during workflow execution — that directory is reserved for Claude Code's built-in plan mode.

This applies to ALL approval gates: batch selection, implementation plans, RED/GREEN/REGRESSION evidence, commit approval, refactor plans, and any other "present and wait" step in any workflow.

## Domain-Specific Rules

If your task touches any of the domains below, **also read the corresponding rules file before starting**. These files contain deeper conventions than fit here.

| When working on... | Also read |
|--------------------|-----------|
| Authentication / sessions / permissions | `.agent/rules/auth_rules.md` (if exists) |
| Database / migrations / queries | `.agent/rules/db_rules.md` (if exists) |
| Background jobs / queues / scheduling | `.agent/rules/jobs_rules.md` (if exists) |
| API endpoints / serializers / validation | `.agent/rules/api_rules.md` (if exists) |
| UI / UX / frontend routes / templates / CSS / page copy / design tokens | `.agent/rules/FRONTEND_IMPECCABLE_RULES.md` |

> These files are created by `/bootstrap` when a domain has 5+ concentrated conventions. If a file doesn't exist for a domain, the relevant rules are here in CODING_STANDARDS.md.
>
> **When you create a new domain rules file or split an existing rules file:** update `.agent/rules/_index.md` with a new row. Pointer files at the project root (`CLAUDE.md`, `AGENTS.md`) reference the index — they do NOT list individual rules files. Adding a row to the index makes the new rule discoverable by every CLI without editing the pointer files.

## Git Commit Convention

**Format:** `type(scope): descriptive message`

| Type | When to use |
|------|------------|
| `feat` | New feature or functionality |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `test` | Adding or updating tests |
| `docs` | Documentation changes |
| `chore` | Tooling, workflows, config, dependencies |
| `style` | Formatting, whitespace, no logic change |

**Scope** = the module, app, or area affected (e.g., `pricing`, `auth`, `db`, `workflows`).

**Rules:**
- Subject line max 72 characters.
- Use imperative mood: "add filter" not "added filter".
- Reference the `[BUG]`/`[FIX]`/`[FEATURE]` from `progress.md` when applicable.
- One commit per completed item. Don't bundle unrelated changes.

**Examples:**
```
feat(pricing): implement UndercutBracket model with tenant FK
fix(sending): guard against None accounts on sending page
refactor(db): extract monitoring queries into dedicated mixin
test(replies): add 11 tests for intent classification edge cases
docs(context): update CODEBASE_CONTEXT.md with new schema tables
chore(workflows): add sprint velocity to resume workflow
```
