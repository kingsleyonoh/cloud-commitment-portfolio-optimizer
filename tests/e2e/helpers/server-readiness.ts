import { createConnection } from "node:net";
import type { ChildProcess } from "node:child_process";
import { childFailure, formatOutput } from "./server-process.js";
import {
  type ChildExit,
  type ChildOutput,
  type ReadySignal,
  ServerStartError,
} from "./server-types.js";

export async function waitForReadySignal(
  child: ChildProcess,
  exit: Promise<ChildExit>,
  output: ChildOutput,
  timeoutMs: number,
): Promise<ReadySignal> {
  const readySignal = createReadySignal(child, output);
  const { timeout, cancel } = createReadyTimeout(child, output, timeoutMs);
  try {
    return await Promise.race([
      readySignal,
      exit.then(() => {
        throw childFailure("E2E server exited before readiness", child, output);
      }),
      timeout,
    ]);
  } finally {
    cancel();
  }
}

export async function waitForTcpReadiness(
  ready: ReadySignal,
  child: ChildProcess,
  exit: Promise<ChildExit>,
  output: ChildOutput,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await exit;
      throw childFailure("E2E server exited during readiness probe", child, output);
    }
    if (await canConnect(ready.host, ready.port, deadline)) return;
    await delay(25);
  }
  throw new ServerStartError(
    `E2E server TCP readiness probe timed out${formatOutput(output)}`,
    child.pid ?? null,
  );
}

function createReadySignal(child: ChildProcess, output: ChildOutput): Promise<ReadySignal> {
  return new Promise((resolve) => {
    let parsedLength = 0;
    const inspect = (): void => {
      const complete = output.stdout.slice(parsedLength);
      const lines = complete.split(/\r?\n/u);
      parsedLength += complete.length - (lines.pop()?.length ?? 0);
      for (const line of lines) {
        const ready = parseReadySignal(line);
        if (ready) return resolve(ready);
      }
    };
    child.stdout?.on("data", inspect);
    inspect();
  });
}

function parseReadySignal(line: string): ReadySignal | null {
  try {
    const candidate = JSON.parse(line) as Partial<ReadySignal>;
    if (
      candidate.event === "listening" &&
      candidate.host === "127.0.0.1" &&
      typeof candidate.port === "number"
    )
      return candidate as ReadySignal;
  } catch {
    return null;
  }
  return null;
}

function createReadyTimeout(
  child: ChildProcess,
  output: ChildOutput,
  timeoutMs: number,
): { timeout: Promise<never>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ServerStartError(
            `E2E server did not become ready within ${timeoutMs}ms${formatOutput(output)}`,
            child.pid ?? null,
          ),
        ),
      timeoutMs,
    );
  });
  return { timeout, cancel: () => timer && clearTimeout(timer) };
}

function canConnect(host: string, port: number, deadline: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (ready: boolean): void => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(Math.min(250, Math.max(1, deadline - Date.now())));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
