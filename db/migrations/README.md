# PostgreSQL migrations

`npm run db:migrate` discovers top-level `*.sql` files named `NNNN_description.sql`, sorts by numeric version, and records each SHA-256 checksum in `_ccpo_schema_migrations` in the target database.

Applied files are immutable: a changed checksum, renamed file, or applied file missing from disk fails closed as schema drift. Each unapplied file and its ledger row run in one transaction under a PostgreSQL advisory lock. The command requires an explicit `DATABASE_URL`; it never guesses or creates the target database.

Phase 0 intentionally contains no domain migrations. Tenant/auth and optimizer data schema begin in Phase 1.
