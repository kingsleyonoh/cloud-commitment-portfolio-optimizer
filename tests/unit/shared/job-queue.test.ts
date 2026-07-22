import { expect, it, vi } from "vitest";
import {
  createDisabledJobQueue,
  createJobQueueCache,
  type JobQueue,
} from "../../../core/shared/jobQueue.js";

it("caches an injected contract adapter and closes it once", async () => {
  const adapter: JobQueue = {
    enqueue: vi.fn(async () => ({ accepted: true as const, jobId: "probe-1" })),
    health: vi.fn(async () => ({ ready: true })),
    close: vi.fn(async () => undefined),
  };
  const factory = vi.fn(async () => adapter);
  const cache = createJobQueueCache(factory);

  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  await expect(
    first.enqueue("contract-probe", { value: 1 }, { idempotencyKey: "probe-key" }),
  ).resolves.toEqual({ accepted: true, jobId: "probe-1" });
  expect(first).toBe(second);
  expect(factory).toHaveBeenCalledTimes(1);
  await Promise.all([cache.close(), cache.close()]);
  expect(adapter.close).toHaveBeenCalledTimes(1);
});

it("reports disabled as non-ready and never acknowledges enqueue", async () => {
  const queue = createDisabledJobQueue();

  await expect(queue.health()).resolves.toEqual({
    ready: false,
    code: "QUEUE_ADAPTER_DISABLED",
  });
  await expect(queue.enqueue("optimizer", {}, { idempotencyKey: "run-1" })).rejects.toMatchObject({
    code: "QUEUE_ADAPTER_DISABLED",
  });
  await queue.close();
});

it("requires a non-empty idempotency key before any adapter call", async () => {
  const queue = createDisabledJobQueue();

  for (const idempotencyKey of ["", "   "]) {
    await expect(queue.enqueue("optimizer", {}, { idempotencyKey })).rejects.toMatchObject({
      code: "QUEUE_IDEMPOTENCY_KEY_REQUIRED",
    });
  }
});
