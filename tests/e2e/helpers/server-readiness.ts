import type { ChildProcess } from "node:child_process";
import { childErrorFailure, childFailure, formatOutput } from "./server-process.js";
import {
  type ChildExit,
  type ChildOutput,
  type ReadySignal,
  ServerStartError,
} from "./server-types.js";

export async function waitForReadySignal(
  child: ChildProcess,
  exit: Promise<ChildExit>,
  childError: Promise<Error>,
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
      childError.then((error) => {
        throw childErrorFailure(
          "E2E server failed to spawn before readiness",
          child,
          error,
          output,
        );
      }),
      timeout,
    ]);
  } finally {
    cancel();
  }
}

export async function waitForHttpReadiness(
  ready: ReadySignal,
  child: ChildProcess,
  exit: Promise<ChildExit>,
  childError: Promise<Error>,
  output: ChildOutput,
  deadline: number,
): Promise<void> {
  const url = `http://${ready.host}:${ready.port}/health`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await exit;
      throw childFailure("E2E server exited during health readiness probe", child, output);
    }
    const readyNow = await Promise.race([
      probeHealth(url, deadline),
      exit.then(() => {
        throw childFailure("E2E server exited during health readiness probe", child, output);
      }),
      childError.then((error) => {
        throw childErrorFailure(
          "E2E server errored during health readiness probe",
          child,
          error,
          output,
        );
      }),
    ]);
    if (readyNow) return;
    await delay(Math.min(25, Math.max(0, deadline - Date.now())));
  }
  throw new ServerStartError(
    `E2E server health readiness probe timed out for ${url}${outputDetails(output)}`,
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
            `E2E server did not become ready within ${timeoutMs}ms (no readiness signal)${outputDetails(output)}`,
            child.pid ?? null,
          ),
        ),
      timeoutMs,
    );
  });
  return { timeout, cancel: () => timer && clearTimeout(timer) };
}

async function probeHealth(url: string, deadline: number): Promise<boolean> {
  const budgetMs = Math.min(250, Math.max(1, deadline - Date.now()));
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(budgetMs),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

function outputDetails(output: ChildOutput): string {
  return formatOutput(output) || ": no child output captured";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
