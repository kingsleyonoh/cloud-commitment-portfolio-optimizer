import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  type ChildExit,
  type ChildOutput,
  type FixtureMode,
  type ServerTarget,
  ServerStartError,
  STOP_TIMEOUT_MS,
} from "./server-types.js";

const FIXTURE_PATH = fileURLToPath(new URL("../fixtures/http-server.mjs", import.meta.url));
const APPLICATION_PATH = fileURLToPath(
  new URL("../../../dist/apps/api/server.js", import.meta.url),
);

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function spawnServer(
  target: ServerTarget,
  port: number,
  mode: FixtureMode,
  environment: Readonly<Record<string, string>> = {},
): ChildProcess {
  const fixture = target === "fixture";
  return spawn(process.execPath, [fixture ? FIXTURE_PATH : APPLICATION_PATH], {
    env: fixture
      ? { ...process.env, E2E_FIXTURE_MODE: mode, E2E_FIXTURE_PORT: String(port) }
      : { ...process.env, ...environment, NODE_ENV: "test", PORT: String(port) },
    shell: false,
    stdio: fixture ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

export function captureOutput(child: ChildProcess): ChildOutput {
  const output = { stdout: "", stderr: "" };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output.stdout = boundedAppend(output.stdout, chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    output.stderr = boundedAppend(output.stderr, chunk);
  });
  return output;
}

export function waitForExit(child: ChildProcess): Promise<ChildExit> {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

export function waitForChildError(child: ChildProcess): Promise<Error> {
  return new Promise((resolve) => {
    child.once("error", resolve);
  });
}

export async function terminateExactChild(
  child: ChildProcess,
  exit: Promise<ChildExit>,
  target: ServerTarget,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exit;
    return;
  }
  if (target === "fixture" && child.connected) child.send({ type: "shutdown" });
  else child.kill("SIGTERM");
  if (await settlesWithin(exit, STOP_TIMEOUT_MS)) return;
  child.kill("SIGKILL");
  if (await settlesWithin(exit, STOP_TIMEOUT_MS)) return;
  throw new ServerStartError(
    `E2E server child ${child.pid ?? "unknown"} did not terminate`,
    child.pid ?? null,
  );
}

export function childFailure(
  prefix: string,
  child: ChildProcess,
  output: ChildOutput,
): ServerStartError {
  const status =
    child.exitCode === null ? `signal ${child.signalCode ?? "unknown"}` : `code ${child.exitCode}`;
  return new ServerStartError(`${prefix} (${status})${formatOutput(output)}`, child.pid ?? null);
}

export function childErrorFailure(
  prefix: string,
  child: ChildProcess,
  error: Error,
  output: ChildOutput,
): ServerStartError {
  return new ServerStartError(
    `${prefix}: ${error.message}${formatOutput(output)}`,
    child.pid ?? null,
    { cause: error },
  );
}

export function formatOutput(output: ChildOutput): string {
  const details = [output.stderr.trim(), output.stdout.trim()].filter(Boolean).join(" | ");
  return details.length === 0 ? "" : `: ${details}`;
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function boundedAppend(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-8_192);
}
