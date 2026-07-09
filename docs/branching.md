# Branching Protocol

- `main`: production only.
- `dev`: integration branch and default PR target.
- `feature/<slug>`: contributor work branches.
- `yolo/batch-*`: legacy Klevar YOLO branches/worktrees from pre-excision projects only; do not create new ones until a future runtime architecture defines a new branch policy.
- `hotfix/<slug>`: emergency fixes from production.

## Rules

- Contributors open PRs into `dev`.
- Legacy YOLO no longer commits to `dev`; future runtime commit policy must be defined before re-enabling autonomous commits.
- Use `--revert --push` for collaboration-safe remote undo.
- Use force-push only with explicit operator approval and only when no other contributor depends on the rewritten branch.
