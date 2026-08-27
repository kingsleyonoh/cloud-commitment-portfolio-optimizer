# Structured Logger

## What it establishes

Logs are one-JSON-record-per-line events with inherited context, recursive redaction, and managed flush/close behavior.

## Files

- `core/shared/logger.ts`
- `tests/unit/shared/logger-errors.test.ts`

## When to read this

Before emitting application, request, tenant, worker, or job logs.

## Contract

- Use event names plus structured attributes; never serialize env/config wholesale.
- Credentials, authorization/cookies, DSNs, connection URLs, and Error internals are redacted.
- Child loggers inherit module/request/job/tenant context.
- Sink write/flush/close failures propagate.

## Cross-references

- `.agent/knowledge/foundation/core-error-normalization.md`
