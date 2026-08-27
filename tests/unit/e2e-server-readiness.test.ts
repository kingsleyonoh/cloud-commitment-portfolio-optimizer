import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { captureOutput, waitForChildError, waitForExit } from "../e2e/helpers/server-process.js";
import { waitForReadySignal } from "../e2e/helpers/server-readiness.js";

describe("E2E child readiness observation", () => {
  it("fails immediately and actionably when the child process cannot spawn", async () => {
    const child = spawn("ccpo-command-that-does-not-exist", [], {
      shell: false,
      windowsHide: true,
    });
    const output = captureOutput(child);
    const exit = waitForExit(child);
    const childError = waitForChildError(child);
    const startedAt = Date.now();

    await expect(waitForReadySignal(child, exit, childError, output, 2_000)).rejects.toMatchObject({
      name: "ServerStartError",
      message: expect.stringContaining("failed to spawn before readiness"),
    });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
