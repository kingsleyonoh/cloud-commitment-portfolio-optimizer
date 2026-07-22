# Error Normalization

## What it establishes

Known errors preserve stable safe fields; unknown values normalize to a correlation-safe `INTERNAL_ERROR` envelope.

## Files

- `core/shared/errors.ts`
- `tests/unit/shared/logger-errors.test.ts`

## When to read this

Before defining error codes, formatting API failures, or logging errors.

## Contract

- Client shape is exactly `{ error: { code, message, details } }`.
- Stack, cause, paths, URLs, credentials, and unknown messages never enter client envelopes.
- `AppError` messages/details must be safe for clients by construction.
- Unknown failures may include only a correlation reference in details.

## Cross-references

- PRD §8b
