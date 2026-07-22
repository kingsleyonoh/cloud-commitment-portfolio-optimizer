# Collaboration Rules

These rules apply when a Klevar project has external contributors, feature branches, or `docs/claims/*.json`. Legacy YOLO execution and runtime-owned branch/state conventions are retired and must not be recreated here.

## Operator Model

A contributor may be a human using Claude Code, Codex, Cursor, Pi, Mesh, or manual tools. Use ordinary contributor identities such as:

- `contributor:<name>`
- `human-manual:<name>`

## Branch Protocol

- `main` is production.
- `dev` is the integration branch.
- `feature/<slug>` is contributor work.
- `hotfix/<slug>` is emergency production repair.

Do not work directly on another operator's branch without explicit approval. Runtime v2 does not own a special branch namespace; an authorized AI or user chooses ordinary local Git mechanics under current project policy.

## Claims Protocol

When multiple operators may work at once, claim work before editing. Claims live in `docs/claims/*.json`:

```json
{
  "schemaVersion": 1,
  "task": "[API] Add survey export — PRD §8b",
  "operator": "contributor:alice",
  "tool": "claude-code",
  "branch": "feature/survey-export",
  "status": "active",
  "startedAt": "2026-05-18T15:30:00Z",
  "expectedFiles": ["src/api/survey-export.ts"]
}
```

Rules:

- Do not claim a task already actively claimed by another operator.
- Do not edit files listed in another active claim's `expectedFiles`.
- Keep `expectedFiles` honest and update the claim if scope changes.
- Mark claims `done` or `released` when finished or abandoned.
- If no claims exist, solo Klevar flow remains unchanged.

These collaboration claims coordinate humans and agents; they are not Runtime v2 acceptance packets, per-file read permits, or restrictions on unclaimed normal project access.

## AI Contributor Workflow

1. Read `docs/progress.md`, this file, and relevant project rules.
2. Create or use the project-approved branch.
3. Add a collaboration claim when parallel contributors require one.
4. Use TDD and run the project regression command.
5. Run the secret scan before PR/commit when project policy requires it.
6. Open a PR into `dev` with evidence when that is the selected collaboration flow.

## Runtime v2 Boundary

Runtime v2 must not interpret collaboration claims, branches, progress state, test output, or worktree state as semantic acceptance. It may report literal facts to a full-rights parent Pi or nested Mesh agent. AI decides how to coordinate with active contributors, subject to ordinary system, user, and project instructions.

Legacy `.yolo/runtime-state.json`, `yolo/batch-*`, runtime claim skipping, and read-only-main-agent rules are historical conventions and are not active Runtime v2 authority. Use current Git status, collaboration claims, Mesh/Agency evidence, and explicit user instructions instead of reconstructing those conventions.
