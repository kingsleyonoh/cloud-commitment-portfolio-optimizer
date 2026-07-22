import { pathToFileURL } from "node:url";
import { bootstrapWorker, type RunningWorker } from "./bootstrap.js";

export interface WorkerProcessBoundary {
  exitCode: NodeJS.Process["exitCode"];
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface WorkerServerController {
  shutdown(signal: NodeJS.Signals): Promise<void>;
}

export interface WorkerProcessOptions {
  bootstrapRuntime?: () => Promise<RunningWorker>;
  fatalLog?: (
    event: "worker.start_failed" | "worker.shutdown_failed",
    code: "QUEUE_ADAPTER_DISABLED" | "INTERNAL_ERROR",
  ) => void;
  processBoundary?: WorkerProcessBoundary;
}

export function isMainModule(moduleUrl: string, entry: string | undefined): boolean {
  if (!entry) return false;
  return moduleUrl === pathToFileURL(entry).href;
}

export async function startWorkerProcess(
  options: WorkerProcessOptions = {},
): Promise<WorkerServerController | undefined> {
  const boundary = options.processBoundary ?? process;
  const fatalLog = options.fatalLog ?? writeFatalEvent;
  let runtime: RunningWorker;
  try {
    runtime = await (options.bootstrapRuntime ?? bootstrapWorker)();
  } catch (error) {
    fatalLog("worker.start_failed", safeFailureCode(error));
    boundary.exitCode = 1;
    return undefined;
  }
  return installShutdown(runtime, boundary, fatalLog);
}

function installShutdown(
  runtime: RunningWorker,
  boundary: WorkerProcessBoundary,
  fatalLog: NonNullable<WorkerProcessOptions["fatalLog"]>,
): WorkerServerController {
  let operation: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    operation ??= runtime
      .close()
      .catch(() => {
        fatalLog("worker.shutdown_failed", "INTERNAL_ERROR");
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

function safeFailureCode(error: unknown): "QUEUE_ADAPTER_DISABLED" | "INTERNAL_ERROR" {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "QUEUE_ADAPTER_DISABLED"
  ) {
    return "QUEUE_ADAPTER_DISABLED";
  }
  return "INTERNAL_ERROR";
}

function writeFatalEvent(
  event: "worker.start_failed" | "worker.shutdown_failed",
  code: "QUEUE_ADAPTER_DISABLED" | "INTERNAL_ERROR",
): void {
  process.stderr.write(`${JSON.stringify({ level: "error", event, code })}\n`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void startWorkerProcess();
}
