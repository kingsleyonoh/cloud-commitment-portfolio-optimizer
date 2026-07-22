import type { ChildProcess } from "node:child_process";
import {
  captureOutput,
  isProcessRunning,
  spawnServer,
  terminateExactChild,
  waitForExit,
} from "./server-process.js";
import { waitForReadySignal, waitForTcpReadiness } from "./server-readiness.js";
import {
  type ChildExit,
  type ChildOutput,
  DEFAULT_STARTUP_TIMEOUT_MS,
  type ReadySignal,
  type RunningServer,
  type ServerTarget,
  ServerStartError,
  type StartServerOptions,
} from "./server-types.js";

export {
  type FixtureMode,
  type RunningServer,
  type ServerTarget,
  ServerStartError,
  type StartServerOptions,
} from "./server-types.js";
export { isProcessRunning } from "./server-process.js";

export async function startE2eServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const port = options.port ?? 0;
  const timeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  validateOptions(port, timeoutMs);
  const target = options.target ?? "fixture";
  const child = spawnServer(target, port, options.mode ?? "ready", options.environment);
  const output = captureOutput(child);
  const exit = waitForExit(child);
  try {
    return await startSpawnedServer(child, exit, output, timeoutMs, target);
  } catch (error) {
    await cleanupFailedStart(child, exit, error, target);
    throw normalizeStartError(error, child.pid ?? null);
  }
}

async function startSpawnedServer(
  child: ChildProcess,
  exit: Promise<ChildExit>,
  output: ChildOutput,
  timeoutMs: number,
  target: ServerTarget,
): Promise<RunningServer> {
  const deadline = Date.now() + timeoutMs;
  const ready = await waitForReadySignal(child, exit, output, timeoutMs);
  const url = `http://${ready.host}:${ready.port}`;
  await waitForTcpReadiness(ready, child, exit, output, deadline);
  if (child.pid === undefined) {
    throw new ServerStartError("E2E server child has no process id", null);
  }
  return createRunningServer(child, exit, output, ready, url, target);
}

function createRunningServer(
  child: ChildProcess,
  exit: Promise<ChildExit>,
  output: ChildOutput,
  ready: ReadySignal,
  url: string,
  target: ServerTarget,
): RunningServer {
  const pid = child.pid!;
  let stopped = false;
  return {
    url,
    port: ready.port,
    pid,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (isProcessRunning(pid)) return terminateExactChild(child, exit, target);
      const result = await exit;
      if (result.code !== 0) throw normalizeExitFailure(child, output);
    },
  };
}

async function cleanupFailedStart(
  child: ChildProcess,
  exit: Promise<ChildExit>,
  primary: unknown,
  target: ServerTarget,
): Promise<void> {
  try {
    await terminateExactChild(child, exit, target);
  } catch (cleanup) {
    throw new AggregateError([primary, cleanup], "E2E startup and child cleanup failed.", {
      cause: primary,
    });
  }
}

function validateOptions(port: number, timeoutMs: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(`E2E server port must be an integer from 0 to 65535; received ${port}`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`E2E server startup timeout must be positive; received ${timeoutMs}`);
  }
}

function normalizeStartError(error: unknown, pid: number | null): ServerStartError {
  if (error instanceof ServerStartError) return error;
  return new ServerStartError(`Unable to start E2E server: ${errorMessage(error)}`, pid, {
    cause: error,
  });
}

function normalizeExitFailure(child: ChildProcess, output: ChildOutput): ServerStartError {
  const code = child.exitCode ?? "unknown";
  return new ServerStartError(
    `E2E server exited unexpectedly (code ${code}): ${output.stderr || output.stdout}`,
    child.pid ?? null,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
