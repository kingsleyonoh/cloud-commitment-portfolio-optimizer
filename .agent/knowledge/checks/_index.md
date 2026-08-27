# Project-Local Checks (catalog)

> **One file per check.** Each check is project-local guidance written or reviewed by ordinary AI/Mesh workflows after path-backed evidence shows a recurring failure pattern. Implementation planning reads matching checks and rejects or revises a plan that would repeat the pattern.
>
> Checks are project-local by design. Stack-class candidates may be queued in `.yolo/harvest-candidates.md` for `/harvest-gotchas` review and possible promotion to template knowledge.
>
> Checks are retire-able via `/audit-reinforcements` when their target pattern no longer exists in the codebase. They are advisory project governance, not Runtime v2 acceptance authority or per-file capability rules.
>
> Filename convention: `{failure_type}-{slug}.md` (lowercase, hyphenated). Example: `tests-wont-green-mock-database-in-integration.md`.

## Catalog

| Filename | Failure type | Slug | Created (batch / date) | Last fired (batch) | Times fired | Status |
|----------|--------------|------|------------------------|---------------------|-------------|--------|
| EXAMPLE.md | (template) | (template) | (template) | — | — | template — delete me |

> Add one row per check file. The evidence-backed AI/Mesh workflow that lands a check updates both the file and this row. `/audit-reinforcements` may update firing evidence and propose retirement when the pattern is dead.
