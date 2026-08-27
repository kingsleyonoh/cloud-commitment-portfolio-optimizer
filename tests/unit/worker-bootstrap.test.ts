import type { AppConfig } from "../../core/config/env.js";
import type { JobQueue } from "../../core/shared/jobQueue.js";
import type { Logger } from "../../core/shared/logger.js";
import { bootstrapWorker } from "../../apps/worker/bootstrap.js";
import type { WorkerResourceName } from "../../apps/worker/resources.js";
import { expect, it, vi } from "vitest";

const config = {
  database: {},
  storage: { objectStoragePath: ".tmp/test-object-store" },
  forecasting: { minHistoryDays: 90 },
} as Readonly<AppConfig>;

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

function queue(): JobQueue {
  return {
    enqueue: vi.fn(async () => ({ accepted: true as const, jobId: "unused" })),
    health: vi.fn(async () => ({ ready: true })),
    close: vi.fn(async () => undefined),
  };
}

function database() {
  return {
    pool: {},
    health: vi.fn(async () => ({ ready: true })),
  } as never;
}

function objectStore() {
  return {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => Buffer.from("")),
    delete: vi.fn(async () => undefined),
    health: vi.fn(async () => ({ ready: true })),
    close: vi.fn(async () => undefined),
  };
}

it("initializes environment, logger, and queue through injection before start", async () => {
  const events: string[] = [];
  const close = vi.fn(async () => {
    events.push("close");
  });
  let initialized: ReadonlySet<WorkerResourceName> | undefined;
  const worker = {
    start: vi.fn(async () => {
      events.push("start");
    }),
    close: vi.fn(async () => undefined),
  };

  const runtime = await bootstrapWorker({
    getConfig: async () => config,
    getLogger: async () => logger(),
    getQueue: async () => queue(),
    getDatabase: async () => database(),
    getObjectStore: async () => objectStore(),
    buildApplication: () => worker,
    createCloser: (_worker, acquired) => {
      initialized = new Set(acquired);
      return close;
    },
  });

  expect(initialized).toEqual(
    new Set<WorkerResourceName>(["environment", "logger", "jobQueue", "database", "objectStore"]),
  );
  expect(events).toEqual(["start"]);
  await runtime.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it("cleans every initialized resource when queue readiness fails", async () => {
  const primary = Object.assign(new Error("disabled"), { code: "QUEUE_ADAPTER_DISABLED" });
  const close = vi.fn(async () => undefined);
  let initialized: ReadonlySet<WorkerResourceName> | undefined;

  await expect(
    bootstrapWorker({
      getConfig: async () => config,
      getLogger: async () => logger(),
      getQueue: async () => queue(),
      getDatabase: async () => database(),
      getObjectStore: async () => objectStore(),
      buildApplication: () => ({
        start: async () => Promise.reject(primary),
        close: async () => undefined,
      }),
      createCloser: (_worker, acquired) => {
        initialized = new Set(acquired);
        return close;
      },
    }),
  ).rejects.toBe(primary);

  expect(initialized).toEqual(
    new Set<WorkerResourceName>(["environment", "logger", "jobQueue", "database", "objectStore"]),
  );
  expect(close).toHaveBeenCalledTimes(1);
});

it("preserves startup and cleanup failures together", async () => {
  const primary = new Error("startup failed");
  const cleanup = new Error("cleanup failed");

  const failure = await bootstrapWorker({
    getConfig: async () => config,
    getLogger: async () => logger(),
    getQueue: async () => queue(),
    getDatabase: async () => database(),
    getObjectStore: async () => objectStore(),
    buildApplication: () => ({
      start: async () => Promise.reject(primary),
      close: async () => undefined,
    }),
    createCloser: () => async () => Promise.reject(cleanup),
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([primary, cleanup]);
});
