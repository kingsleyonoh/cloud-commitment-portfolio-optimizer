# Rules — Index

> Single source of truth for which rules apply to this project. Pointer files at the project root (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`) reference this file.

## Core rules (load selectively after triage)

| File | Purpose |
|------|---------|
| `CODEBASE_CONTEXT.md` | Tech stack, schema, env vars, commands, project structure |
| `CODING_STANDARDS.md` | Core AI discipline, git, file size limits, append-only files banned |
| `CODING_STANDARDS_META.md` | Skill orchestration, PowerShell environment, git branching |
| `CODING_STANDARDS_TESTING.md` | Core TDD workflow (RED/GREEN/REGRESSION), anti-cheat |
| `CODING_STANDARDS_TESTING_LOGIC.md` | Business logic correctness, multi-tenant fixtures, edge cases, test modularity |
| `CODING_STANDARDS_TESTING_LIVE.md` | Mock policy, component/API integration testing |
| `CODING_STANDARDS_TESTING_E2E.md` | E2E testing over real HTTP |
| `CODING_STANDARDS_DOMAIN.md` | Deployment, security, naming conventions, project domain constraints |
| `COLLABORATION_RULES.md` | Branch, claim, and AI-assisted contributor coordination rules |
| `FRONTEND_IMPECCABLE_RULES.md` | UI/UX quality rules for frontend routes, templates, CSS, page copy, design tokens |

## Domain-specific routing

Domain conventions currently live in the core/domain rules files above. Add domain-specific files here only when `/bootstrap` or `/sync-context` creates an actual file.

## How to update this index

- New rules file added: append a row to the relevant table.
- Rules file split: append the new file to Core rules.
- Rules file removed: delete its row.
- Pointer files never inline this table; they reference this file.
