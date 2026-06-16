# Cloud Commitment Portfolio Optimizer — Coding Standards: Meta

Load this for skill selection, shell environment, workflows, and branching/process concerns.

## Skill Selection

- Before implementation, scan available skills and read the most specific matching `SKILL.md`.
- Use project/Klevar skills for bootstrap, workflow, YOLO, sync, or lifecycle work.
- Use frontend/design guidance when building UI routes, page copy, Tailwind tokens, charts, or responsive states.
- Use deployment skills for Docker/VPS/NAS/container rollout tasks.
- Skill instructions override memory when they are more specific to the task.

## Workflow Discipline

- Follow `.agent/workflows/*` exactly when a workflow is invoked.
- If a step says present/wait/approve, ask in conversation and wait; do not use external plan-mode tools.
- After any workflow, read `.agent/workflows/PIPELINE.md` and suggest the next step.
- Do not create new workflows unless an existing one cannot be extended; keep workflow count bounded.

## Shell Environment

- Use commands from `CODEBASE_CONTEXT.md`.
- Local infra: PostgreSQL + Redis via Docker Compose; DuckDB is embedded; object storage is local filesystem.
- Prefer npm scripts over ad-hoc commands once scripts exist.
- On Windows/PowerShell, use `;` instead of `&&`; for complex scripts, write a script file instead of inline command strings.

## Branching and Git

- Default development branch is `dev`; production branch is `main`.
- Do not commit, push, merge, rebase, or run remote operations unless explicitly requested.
- Never force-add ignored files.
- Hotfixes branch from `main`, merge back to both `main` and `dev`, and must include tests.

## YOLO Inbox

- If asked to add YOLO feedback, follow `.agent/workflows/yolo-feedback.md` exactly.
- That workflow may write only `docs/yolo-inbox.md` and must not edit source, `.yolo/`, `progress.md`, or git state.

## Evidence Habit

- For non-trivial work, cite changed file paths and any command/test evidence.
- If work was documentation/bootstrap-only and tests were not run, say so plainly.
