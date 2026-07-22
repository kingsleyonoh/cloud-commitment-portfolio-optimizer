# Job Queue Adapter

## What it establishes

The queue boundary is typed, idempotency-keyed, lifecycle-managed, and fail-closed while no Redis adapter exists.

## Files

- `core/shared/jobQueue.ts`
- `tests/unit/shared/job-queue.test.ts`

## When to read this

Before enqueueing a job or introducing the first real Redis queue adapter.

## Contract

- Every enqueue requires a non-empty idempotency key.
- Disabled health is non-ready and enqueue throws `QUEUE_ADAPTER_DISABLED`.
- Never use an in-memory production queue or acknowledge work that was not persisted.
- Add a Redis dependency only with a real local integration test.

## Cross-references

- PRD §7 and §10b
