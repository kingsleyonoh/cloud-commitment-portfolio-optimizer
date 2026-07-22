import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import {
  isMainModule,
  startWorkerProcess,
  type WorkerProcessBoundary,
} from "../../apps/worker/server.js";
import { describe, expect, it, vi } from "vitest";

class FakeProcess extends EventEmitter implements WorkerProcessBoundary {
  exitCode: NodeJS.Process["exitCode"];

  override once(event: NodeJS.Signals, listener: () => void): this {
    return super.once(event, listener);
  }
}

describe("executable worker boundary", () => {
  it("detects direct execution without starting when imported", () => {
    const entry = process.platform === "win32" ? "C:\\project\\server.js" : "/project/server.js";

    expect(isMainModule(pathToFileURL(entry).href, entry)).toBe(true);
    expect(isMainModule("file:///project/imported.js", entry)).toBe(false);
  });

  it("reports the stable disabled code, exits non-zero, and installs no signals", async () => {
    const processBoundary = new FakeProcess();
    const fatalLog = vi.fn();
    const disabled = Object.assign(new Error("private queue details"), {
      code: "QUEUE_ADAPTER_DISABLED",
    });

    const controller = await startWorkerProcess({
      bootstrapRuntime: async () => Promise.reject(disabled),
      fatalLog,
      processBoundary,
    });

    expect(controller).toBeUndefined();
    expect(processBoundary.exitCode).toBe(1);
    expect(processBoundary.listenerCount("SIGINT")).toBe(0);
    expect(processBoundary.listenerCount("SIGTERM")).toBe(0);
    expect(fatalLog).toHaveBeenCalledWith("worker.start_failed", "QUEUE_ADAPTER_DISABLED");
  });

  it("converges SIGINT and SIGTERM on one close and removes both listeners", async () => {
    const processBoundary = new FakeProcess();
    const close = vi.fn(async () => undefined);
    const controller = await startWorkerProcess({
      bootstrapRuntime: async () => ({ close }),
      fatalLog: vi.fn(),
      processBoundary,
    });

    expect(processBoundary.listenerCount("SIGINT")).toBe(1);
    expect(processBoundary.listenerCount("SIGTERM")).toBe(1);
    processBoundary.emit("SIGINT");
    processBoundary.emit("SIGTERM");
    const first = controller!.shutdown("SIGINT");
    const second = controller!.shutdown("SIGTERM");

    expect(second).toBe(first);
    await first;
    expect(close).toHaveBeenCalledTimes(1);
    expect(processBoundary.listenerCount("SIGINT")).toBe(0);
    expect(processBoundary.listenerCount("SIGTERM")).toBe(0);
  });

  it("sets non-zero when injected-ready shutdown fails without leaking details", async () => {
    const processBoundary = new FakeProcess();
    const fatalLog = vi.fn();
    const controller = await startWorkerProcess({
      bootstrapRuntime: async () => ({
        close: async () => Promise.reject(new Error("secret shutdown detail")),
      }),
      fatalLog,
      processBoundary,
    });

    await controller!.shutdown("SIGTERM");

    expect(processBoundary.exitCode).toBe(1);
    expect(fatalLog).toHaveBeenCalledWith("worker.shutdown_failed", "INTERNAL_ERROR");
  });
});
