import type { JobQueue } from "../../core/shared/jobQueue.js";
import type { Logger } from "../../core/shared/logger.js";
import { buildWorker } from "../../apps/worker/app.js";
import { expect, it, vi } from "vitest";

function queue(ready: boolean, code?: string): JobQueue {
  return {
    enqueue: vi.fn(async () => ({ accepted: true as const, jobId: "must-not-run" })),
    health: vi.fn(async () => (code ? { ready, code } : { ready })),
    close: vi.fn(async () => undefined),
  };
}

function logger(): Logger {
  const value: Logger = {
    debug: vi.fn(async () => undefined),
    info: vi.fn(async () => undefined),
    warn: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
    child: () => value,
    flush: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return value;
}

it("fails closed with the stable disabled queue code and performs no work", async () => {
  const jobQueue = queue(false, "QUEUE_ADAPTER_DISABLED");
  const worker = buildWorker({ queue: jobQueue, logger: logger() });

  await expect(worker.start()).rejects.toMatchObject({ code: "QUEUE_ADAPTER_DISABLED" });

  expect(jobQueue.health).toHaveBeenCalledTimes(1);
  expect(jobQueue.enqueue).not.toHaveBeenCalled();
});

it("starts with an injected ready queue without enqueueing or polling", async () => {
  const jobQueue = queue(true);
  const workerLogger = logger();
  const worker = buildWorker({ queue: jobQueue, logger: workerLogger });

  await worker.start();
  await worker.close();
  await worker.close();

  expect(jobQueue.health).toHaveBeenCalledTimes(1);
  expect(jobQueue.enqueue).not.toHaveBeenCalled();
  expect(workerLogger.info).toHaveBeenCalledTimes(1);
  expect(workerLogger.info).toHaveBeenCalledWith("worker.ready");
});
