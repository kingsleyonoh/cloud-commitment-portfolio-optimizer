import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ServerStartError, isProcessRunning, startE2eServer } from "./helpers/server.js";

const execFileAsync = promisify(execFile);
const IPC_DISCONNECT_PROBE_PATH = fileURLToPath(
  new URL("./fixtures/ipc-disconnect-probe.mjs", import.meta.url),
);

test("stops the exact fixture child when its owner IPC channel disconnects", async () => {
  const { stdout } = await execFileAsync(process.execPath, [IPC_DISCONNECT_PROBE_PATH], {
    timeout: 5_000,
    windowsHide: true,
  });
  const result = JSON.parse(stdout) as {
    pid: number;
    ready: { port: number };
    stoppedAfterDisconnect: boolean;
  };

  expect(result.ready.port).toBeGreaterThan(0);
  expect(result.stoppedAfterDisconnect).toBe(true);
  expect(isProcessRunning(result.pid)).toBe(false);
});

test("starts concurrent fixture servers on distinct OS-assigned ports and stops only their children", async () => {
  const [first, second] = await Promise.all([startE2eServer(), startE2eServer()]);

  try {
    expect(first.port).not.toBe(second.port);
    await expect((await fetch(`${first.url}/health`)).json()).resolves.toEqual({
      status: "ready",
    });
    await expect((await fetch(`${second.url}/health`)).json()).resolves.toEqual({
      status: "ready",
    });
    expect(isProcessRunning(first.pid)).toBe(true);
    expect(isProcessRunning(second.pid)).toBe(true);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
  }

  expect(isProcessRunning(first.pid)).toBe(false);
  expect(isProcessRunning(second.pid)).toBe(false);
});

test("reports an occupied requested port and reaps the failed child", async () => {
  const blocker = await startE2eServer();
  let failure: unknown;
  try {
    await startE2eServer({ port: blocker.port });
  } catch (error) {
    failure = error;
  } finally {
    await blocker.stop();
  }

  expect(failure).toBeInstanceOf(ServerStartError);
  const startError = failure as ServerStartError;
  expect(startError.message).toContain("exited before readiness");
  expect(startError.pid).not.toBeNull();
  expect(isProcessRunning(startError.pid!)).toBe(false);
});

test("propagates a pre-readiness child failure and reaps the exact child", async () => {
  let failure: unknown;
  try {
    await startE2eServer({ mode: "exit-before-ready" });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(ServerStartError);
  const startError = failure as ServerStartError;
  expect(startError.message).toContain("fixture child failed intentionally");
  expect(startError.pid).not.toBeNull();
  expect(isProcessRunning(startError.pid!)).toBe(false);
});

test("times out clearly when readiness never arrives and reaps the exact child", async () => {
  let failure: unknown;
  try {
    await startE2eServer({
      mode: "never-ready",
      startupTimeoutMs: 250,
    });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(ServerStartError);
  const startError = failure as ServerStartError;
  expect(startError.message).toContain("did not become ready within 250ms");
  expect(startError.pid).not.toBeNull();
  expect(isProcessRunning(startError.pid!)).toBe(false);
});
