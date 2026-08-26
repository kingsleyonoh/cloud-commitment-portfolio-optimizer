import { AppError } from "../../core/shared/errors.js";
import type { ApprovalExpiryWorker } from "../../core/approvals/approval-expiry-worker.js";
import type { BacktestWorker } from "../../core/backtests/backtest-worker.js";
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
  approvals?: ApprovalExpiryWorker;
  backtests?: BacktestWorker;
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
  const approvalResult = await options.approvals?.processExpiredApprovals();
  const backtestResult = await options.backtests?.processNextBacktest();
  await options.logger.info("worker.ready", {
    approval_expiry_processed: approvalResult?.processed ?? false,
    approval_expiry_count: approvalResult?.approvalIds.length ?? 0,
    forecast_processed: forecastResult?.processed ?? false,
    forecast_run_id: forecastResult?.processed ? forecastResult.runId : null,
    forecast_status: forecastResult?.processed ? forecastResult.status : null,
    optimizer_processed: optimizerResult?.processed ?? false,
    optimizer_run_id: optimizerResult?.processed ? optimizerResult.runId : null,
    optimizer_status: optimizerResult?.processed ? optimizerResult.status : null,
    backtest_processed: backtestResult?.processed ?? false,
    backtest_run_id: backtestResult?.processed ? backtestResult.runId : null,
    backtest_status: backtestResult?.processed ? backtestResult.status : null,
  });
}
