import { AppError } from "../../core/shared/errors.js";
import type { ApprovalExpiryWorker } from "../../core/approvals/approval-expiry-worker.js";
import type { EcosystemAdaptersService } from "../../core/adapters/ecosystem-service.js";
import type { BacktestWorker } from "../../core/backtests/backtest-worker.js";
import type { ForecastWorker } from "../../core/forecasting/forecast-worker.js";
import type { OptimizerWorker } from "../../core/optimizer-runs/optimizer-worker.js";
import type { JobQueue } from "../../core/shared/jobQueue.js";
import type { Logger } from "../../core/shared/logger.js";
import type { QueueLagMetric } from "../../core/observability/queue-lag.js";

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
  adapters?: EcosystemAdaptersService;
  pollIntervalMs?: number;
  queueLagProbe?: () => Promise<QueueLagMetric>;
}

export function buildWorker(options: BuildWorkerOptions): WorkerApplication {
  let startOperation: Promise<void> | undefined;
  let cycleOperation: Promise<void> | undefined;
  let poller: NodeJS.Timeout | undefined;
  let closed = false;
  return {
    start() {
      startOperation ??= startWorker(options).then(() => {
        const interval = options.pollIntervalMs ?? 0;
        if (interval > 0) {
          poller = setInterval(() => {
            if (closed || cycleOperation) return;
            cycleOperation = runCycle(options)
              .then(async (result) => {
                await options.logger.info("worker.cycle.completed", {
                  duration_ms: result.durationMs,
                  processed: result.processed,
                });
                const lag = await options.queueLagProbe?.();
                if (lag) {
                  await options.logger.info("queue.lag", {
                    depth: lag.depth,
                    lag_seconds: lag.lagSeconds,
                  });
                }
              })
              .catch((error: unknown) =>
                options.logger.warn("worker.cycle.failed", {
                  code: workerErrorCode(error),
                }),
              )
              .finally(() => {
                cycleOperation = undefined;
              });
          }, interval);
          poller.unref();
        }
      });
      return startOperation;
    },
    close: async () => {
      closed = true;
      if (poller) clearInterval(poller);
      await cycleOperation;
    },
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
  const result = await runCycle(options);
  await options.logger.info("worker.ready", {
    ...result.summary,
  });
}

interface WorkerCycleResult {
  durationMs: number;
  processed: number;
  summary: Record<string, unknown>;
}

async function runCycle(options: BuildWorkerOptions): Promise<WorkerCycleResult> {
  const startedAt = Date.now();
  const forecastResult = await options.forecasts?.processNextForecastRun();
  const optimizerResult = await options.optimizers?.processNextOptimizerRun();
  const approvalResult = await options.approvals?.processExpiredApprovals();
  const backtestResult = await options.backtests?.processNextBacktest();
  const adapterResult = await options.adapters?.processNext();
  const summary = {
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
    ...(options.adapters
      ? {
          adapter_processed: adapterResult?.processed ?? false,
          adapter_event_id: adapterResult?.processed ? adapterResult.eventId : null,
          adapter_status: adapterResult?.processed ? adapterResult.status : null,
        }
      : {}),
  };
  const processed = Object.values(summary).filter((value) => value === true).length;
  return { durationMs: Date.now() - startedAt, processed, summary };
}

function workerErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "WORKER_CYCLE_FAILED";
}
