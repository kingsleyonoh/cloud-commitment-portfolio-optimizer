import { AppError } from "../../core/shared/errors.js";
import type { JobQueue } from "../../core/shared/jobQueue.js";
import type { Logger } from "../../core/shared/logger.js";

export interface WorkerApplication {
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface BuildWorkerOptions {
  queue: JobQueue;
  logger: Logger;
}

export function buildWorker(options: BuildWorkerOptions): WorkerApplication {
  let startOperation: Promise<void> | undefined;
  return {
    start() {
      startOperation ??= startWorker(options);
      return startOperation;
    },
    close: () => Promise.resolve(),
  };
}

async function startWorker(options: BuildWorkerOptions): Promise<void> {
  const health = await options.queue.health();
  if (!health.ready) {
    throw new AppError({
      code: health.code ?? "QUEUE_UNAVAILABLE",
      message: "The worker queue is unavailable.",
      statusCode: 503,
    });
  }
  await options.logger.info("worker.ready");
}
