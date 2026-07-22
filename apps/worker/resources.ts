import { closeEnvironmentConfig } from "../../core/config/env.js";
import { closeJobQueue } from "../../core/shared/jobQueue.js";
import { closeLogger } from "../../core/shared/logger.js";
import type { WorkerApplication } from "./app.js";

export type WorkerResourceName = "jobQueue" | "environment" | "logger";
export type WorkerResourceClosers = Readonly<Record<WorkerResourceName, () => Promise<void>>>;

const closeOrder: readonly WorkerResourceName[] = ["jobQueue", "environment", "logger"];
const defaultClosers: WorkerResourceClosers = {
  jobQueue: closeJobQueue,
  environment: closeEnvironmentConfig,
  logger: closeLogger,
};

export function createWorkerRuntimeCloser(
  worker: Pick<WorkerApplication, "close"> | undefined,
  initialized: ReadonlySet<WorkerResourceName>,
  closers: WorkerResourceClosers = defaultClosers,
): () => Promise<void> {
  let operation: Promise<void> | undefined;
  return () => {
    operation ??= closeRuntime(worker, initialized, closers);
    return operation;
  };
}

async function closeRuntime(
  worker: Pick<WorkerApplication, "close"> | undefined,
  initialized: ReadonlySet<WorkerResourceName>,
  closers: WorkerResourceClosers,
): Promise<void> {
  const failures: unknown[] = [];
  if (worker) await attempt(worker.close, failures);
  for (const name of closeOrder) {
    if (initialized.has(name)) await attempt(closers[name], failures);
  }
  if (failures.length > 0) throw new AggregateError(failures, "Worker shutdown failed.");
}

async function attempt(operation: () => Promise<unknown>, failures: unknown[]): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}
