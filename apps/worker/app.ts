import { AppError } from "../../core/shared/errors.js";
import type { ForecastWorker } from "../../core/forecasting/forecast-worker.js";
import type { OptimizerWorker } from "../../core/optimizer-runs/optimizer-worker.js";
import type { JobQueue } from "../../core/shared/jobQueue.js";
import type { Logger } from "../../core/shared/logger.js";

export interface WorkerApplication {
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface BuildWorkerOptions {
  queue: JobQueue;
  logger: Logger;
  forecasts?: ForecastWorker;
  optimizers?: OptimizerWorker;
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
  const forecastResult = await options.forecasts?.processNextForecastRun();
  const optimizerResult = await options.optimizers?.processNextOptimizerRun();
  await options.logger.info("worker.ready", {
    forecast_processed: forecastResult?.processed ?? false,
    forecast_run_id: forecastResult?.processed ? forecastResult.runId : null,
    forecast_status: forecastResult?.processed ? forecastResult.status : null,
    optimizer_processed: optimizerResult?.processed ?? false,
    optimizer_run_id: optimizerResult?.processed ? optimizerResult.runId : null,
    optimizer_status: optimizerResult?.processed ? optimizerResult.status : null,
  });
}
