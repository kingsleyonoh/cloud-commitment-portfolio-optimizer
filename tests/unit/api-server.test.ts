import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { isMainModule, startServerProcess, type ProcessBoundary } from "../../apps/api/server.js";
import { describe, expect, it, vi } from "vitest";

class FakeProcess extends EventEmitter implements ProcessBoundary {
  exitCode: NodeJS.Process["exitCode"];

  override once(event: NodeJS.Signals, listener: () => void): this {
    return super.once(event, listener);
  }
}

describe("executable API server boundary", () => {
  it("detects direct execution without starting when imported", () => {
    const entry = process.platform === "win32" ? "C:\\project\\server.js" : "/project/server.js";

    expect(isMainModule(pathToFileURL(entry).href, entry)).toBe(true);
    expect(isMainModule("file:///project/imported.js", entry)).toBe(false);
    expect(isMainModule("file:///project/imported.js", undefined)).toBe(false);
  });

  it("logs startup failure safely, sets a non-zero exit code, and installs no signals", async () => {
    const processBoundary = new FakeProcess();
    const fatalLog = vi.fn();

    const controller = await startServerProcess({
      bootstrapRuntime: async () => {
        throw new Error("Bearer should-not-be-logged");
      },
      fatalLog,
      processBoundary,
    });

    expect(controller).toBeUndefined();
    expect(processBoundary.exitCode).toBe(1);
    expect(processBoundary.listenerCount("SIGINT")).toBe(0);
    expect(processBoundary.listenerCount("SIGTERM")).toBe(0);
    expect(fatalLog).toHaveBeenCalledWith("server.start_failed");
  });

  it("converges SIGINT and SIGTERM on one idempotent shutdown", async () => {
    const processBoundary = new FakeProcess();
    const close = vi.fn(async () => undefined);
    const controller = await startServerProcess({
      bootstrapRuntime: async () => ({ close }),
      fatalLog: vi.fn(),
      processBoundary,
    });

    expect(controller).toBeDefined();
    const first = controller!.shutdown("SIGINT");
    const second = controller!.shutdown("SIGTERM");

    expect(second).toBe(first);
    await first;
    expect(close).toHaveBeenCalledTimes(1);
  });
});
