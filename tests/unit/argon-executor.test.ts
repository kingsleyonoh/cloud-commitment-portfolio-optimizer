import { describe, expect, it } from "vitest";

import {
  ArgonExecutorConfigurationError,
  createArgonExecutor,
} from "../../core/tenant/argon-executor.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("bounded Argon executor", () => {
  it("never exceeds configured active and queued bounds and fails closed on saturation", async () => {
    const executor = createArgonExecutor({ concurrency: 2, queueLimit: 2 });
    const gates = Array.from({ length: 4 }, deferred);
    const jobs = gates.map((gate, index) =>
      executor.run(async () => gate.promise.then(() => index)),
    );
    await Promise.resolve();

    expect(executor.snapshot()).toEqual({ active: 2, queued: 2, closed: false });
    await expect(executor.run(async () => 5)).rejects.toMatchObject({
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      statusCode: 503,
    });
    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.resolve();
    gates[2]!.resolve();
    gates[3]!.resolve();
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3]);
    expect(executor.snapshot()).toEqual({ active: 0, queued: 0, closed: false });
  });

  it("enforces production maxima and maps worker failures or closure to safe 503", async () => {
    expect(() => createArgonExecutor({ concurrency: 0, queueLimit: 1 })).toThrow(
      ArgonExecutorConfigurationError,
    );
    expect(() => createArgonExecutor({ concurrency: 3, queueLimit: 1 })).toThrow(
      ArgonExecutorConfigurationError,
    );
    expect(() => createArgonExecutor({ concurrency: 1, queueLimit: 33 })).toThrow(
      ArgonExecutorConfigurationError,
    );

    const executor = createArgonExecutor({ concurrency: 1, queueLimit: 0 });
    await expect(
      executor.run(async () => {
        throw new Error("native worker detail");
      }),
    ).rejects.toMatchObject({ code: "AUTH_DEPENDENCY_UNAVAILABLE", statusCode: 503 });
    await expect(
      executor.run(() => {
        throw new Error("synchronous worker detail");
      }),
    ).rejects.toMatchObject({ code: "AUTH_DEPENDENCY_UNAVAILABLE", statusCode: 503 });
    executor.close();
    await expect(executor.run(async () => true)).rejects.toMatchObject({
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      statusCode: 503,
    });
  });
});
