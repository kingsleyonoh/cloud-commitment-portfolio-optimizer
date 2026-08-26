import {
  createWorkerRuntimeCloser,
  type WorkerResourceClosers,
  type WorkerResourceName,
} from "../../apps/worker/resources.js";
import { describe, expect, it, vi } from "vitest";

const names: readonly WorkerResourceName[] = [
  "jobQueue",
  "database",
  "objectStore",
  "environment",
  "logger",
];

function closers(
  events: string[],
  failures = new Set<WorkerResourceName>(),
): WorkerResourceClosers {
  return Object.fromEntries(
    names.map((name) => [
      name,
      vi.fn(async () => {
        events.push(name);
        if (failures.has(name)) throw new Error(`${name} failed`);
      }),
    ]),
  ) as unknown as WorkerResourceClosers;
}

describe("worker resource shutdown", () => {
  it("closes worker boundary, queue, database, object store, environment, then logger", async () => {
    const events: string[] = [];
    const resources = closers(events);
    const worker = {
      close: vi.fn(async () => {
        events.push("worker");
      }),
    };

    await createWorkerRuntimeCloser(worker, new Set(names), resources)();

    expect(events).toEqual([
      "worker",
      "jobQueue",
      "database",
      "objectStore",
      "environment",
      "logger",
    ]);
  });

  it("attempts every acquired close, aggregates failures, and is idempotent", async () => {
    const events: string[] = [];
    const resources = closers(events, new Set(["jobQueue", "logger"]));
    const worker = {
      close: vi.fn(async () => {
        events.push("worker");
        throw new Error("worker failed");
      }),
    };
    const close = createWorkerRuntimeCloser(worker, new Set(names), resources);

    const first = close();
    const second = close();
    const failure = await first.catch((error: unknown) => error);

    expect(second).toBe(first);
    expect(events).toEqual([
      "worker",
      "jobQueue",
      "database",
      "objectStore",
      "environment",
      "logger",
    ]);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(3);
  });
});
