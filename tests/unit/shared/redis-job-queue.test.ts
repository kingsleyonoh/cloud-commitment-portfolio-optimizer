import { describe, expect, it, vi } from "vitest";

import { createRedisJobQueue } from "../../../core/shared/jobQueue.js";

function client() {
  return {
    isOpen: false,
    on: vi.fn(),
    connect: vi.fn(async function (this: { isOpen: boolean }) {
      this.isOpen = true;
    }),
    get: vi.fn(async () => null as string | null),
    set: vi.fn(async () => "OK" as const),
    lPush: vi.fn(async () => 1),
    lTrim: vi.fn(async () => "OK" as const),
    ping: vi.fn(async () => "PONG"),
    quit: vi.fn(async function (this: { isOpen: boolean }) {
      this.isOpen = false;
    }),
  };
}

describe("Redis job queue", () => {
  it("connects lazily, hashes idempotency keys, and records bounded jobs", async () => {
    const redis = client();
    const queue = createRedisJobQueue("redis://localhost:6379", {
      client: redis as never,
      idempotencyTtlSeconds: 60,
    });

    await expect(
      queue.enqueue("optimizer", { optimizer_run_id: "run-1" }, { idempotencyKey: "secret-key" }),
    ).resolves.toMatchObject({ accepted: true });
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ccpo:job:idempotency:[0-9a-f]{64}$/u),
      expect.any(String),
      { NX: true, EX: 60 },
    );
    expect(redis.lPush).toHaveBeenCalledWith(
      "ccpo:jobs:optimizer",
      expect.not.stringContaining("secret-key"),
    );
    await queue.close();
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  it("returns the existing job when an idempotency key is replayed", async () => {
    const redis = client();
    redis.get.mockResolvedValue("job-existing");
    const queue = createRedisJobQueue("redis://localhost:6379", { client: redis as never });

    await expect(queue.enqueue("forecast", {}, { idempotencyKey: "same-key" })).resolves.toEqual({
      accepted: true,
      jobId: "job-existing",
    });
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.lPush).not.toHaveBeenCalled();
    await queue.close();
  });
});
