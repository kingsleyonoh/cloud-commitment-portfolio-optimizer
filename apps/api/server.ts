import { pathToFileURL } from "node:url";
import { bootstrap, type RunningRuntime } from "./bootstrap.js";

export interface ProcessBoundary {
  exitCode: NodeJS.Process["exitCode"];
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface ServerController {
  shutdown(signal: NodeJS.Signals): Promise<void>;
}

export interface ServerProcessOptions {
  bootstrapRuntime?: () => Promise<Pick<RunningRuntime, "close">>;
  fatalLog?: (event: "server.start_failed" | "server.shutdown_failed") => void;
  processBoundary?: ProcessBoundary;
}

export function isMainModule(moduleUrl: string, entry: string | undefined): boolean {
  if (!entry) return false;
  return moduleUrl === pathToFileURL(entry).href;
}

export async function startServerProcess(
  options: ServerProcessOptions = {},
): Promise<ServerController | undefined> {
  const boundary = options.processBoundary ?? process;
  const fatalLog = options.fatalLog ?? writeFatalEvent;
  let runtime: Pick<RunningRuntime, "close">;
  try {
    runtime = await (options.bootstrapRuntime ?? bootstrap)();
  } catch {
    fatalLog("server.start_failed");
    boundary.exitCode = 1;
    return undefined;
  }
  return installShutdown(runtime, boundary, fatalLog);
}

function installShutdown(
  runtime: Pick<RunningRuntime, "close">,
  boundary: ProcessBoundary,
  fatalLog: (event: "server.start_failed" | "server.shutdown_failed") => void,
): ServerController {
  let operation: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    operation ??= runtime
      .close()
      .catch(() => {
        fatalLog("server.shutdown_failed");
        boundary.exitCode = 1;
      })
      .finally(removeSignals);
    return operation;
  };
  const onSigint = (): void => void shutdown();
  const onSigterm = (): void => void shutdown();
  const removeSignals = (): void => {
    boundary.removeListener("SIGINT", onSigint);
    boundary.removeListener("SIGTERM", onSigterm);
  };
  boundary.once("SIGINT", onSigint);
  boundary.once("SIGTERM", onSigterm);
  return { shutdown: () => shutdown() };
}

function writeFatalEvent(event: "server.start_failed" | "server.shutdown_failed"): void {
  process.stderr.write(`${JSON.stringify({ level: "error", event })}\n`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void startServerProcess();
}
