import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeCloser,
  type ResourceClosers,
  type ResourceName,
} from "../../apps/api/resources.js";

const resourceOrder: ResourceName[] = [
  "usersLimiter",
  "registrationLimiter",
  "database",
  "jobQueue",
  "objectStore",
  "duckdbAnalytics",
  "environment",
  "logger",
];

function recordingClosers(events: string[], failures = new Set<ResourceName>()): ResourceClosers {
  return Object.fromEntries(
    resourceOrder.map((name) => [
      name,
      vi.fn(async () => {
        events.push(name);
        if (failures.has(name)) throw new Error(`${name} failed`);
      }),
    ]),
  ) as unknown as ResourceClosers;
}

describe("application resource shutdown", () => {
  it("drains Fastify first, closes only initialized helpers, and closes logger last", async () => {
    const events: string[] = [];
    const closers = recordingClosers(events);
    const app = { close: vi.fn(async () => events.push("app")) };
    const initialized = new Set<ResourceName>(["database", "objectStore", "environment", "logger"]);

    await createRuntimeCloser(app, initialized, closers)();

    expect(events).toEqual(["app", "database", "objectStore", "environment", "logger"]);
    expect(closers.jobQueue).not.toHaveBeenCalled();
    expect(closers.duckdbAnalytics).not.toHaveBeenCalled();
  });

  it("attempts every initialized close and retains every failure", async () => {
    const events: string[] = [];
    const closers = recordingClosers(events, new Set(["database", "environment", "logger"]));
    const app = {
      close: vi.fn(async () => {
        events.push("app");
        throw new Error("app failed");
      }),
    };
    const initialized = new Set<ResourceName>(resourceOrder);

    const close = createRuntimeCloser(app, initialized, closers);
    const failure = await close().catch((error: unknown) => error);

    expect(events).toEqual(["app", ...resourceOrder]);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(4);
  });

  it("is idempotent even when shutdown rejects", async () => {
    const closers = recordingClosers([], new Set(["logger"]));
    const app = { close: vi.fn(async () => undefined) };
    const close = createRuntimeCloser(app, new Set<ResourceName>(["logger"]), closers);

    const first = close();
    const second = close();

    expect(second).toBe(first);
    await expect(first).rejects.toBeInstanceOf(AggregateError);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(closers.logger).toHaveBeenCalledTimes(1);
  });
});
