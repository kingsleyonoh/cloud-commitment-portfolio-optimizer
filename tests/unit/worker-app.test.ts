import type { JobQueue } from "../../core/shared/jobQueue.js";
import type { Logger } from "../../core/shared/logger.js";
import { buildWorker } from "../../apps/worker/app.js";
import { expect, it, vi } from "vitest";

function queue(ready: boolean, code?: string): JobQueue {
  return {
    enqueue: vi.fn(async () => ({ accepted: true as const, jobId: "must-not-run" })),
    health: vi.fn(async () => (code ? { ready, code } : { ready })),
    close: vi.fn(async () => undefined),
  };
}

function logger(): Logger {
  const value: Logger = {
    debug: vi.fn(async () => undefined),
    info: vi.fn(async () => undefined),
    warn: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
    child: () => value,
    flush: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return value;
}

it("fails closed with the stable disabled queue code and performs no work", async () => {
  const jobQueue = queue(false, "QUEUE_ADAPTER_DISABLED");
  const worker = buildWorker({ queue: jobQueue, logger: logger() });

  await expect(worker.start()).rejects.toMatchObject({ code: "QUEUE_ADAPTER_DISABLED" });

  expect(jobQueue.health).toHaveBeenCalledTimes(1);
  expect(jobQueue.enqueue).not.toHaveBeenCalled();
});

it("starts with an injected ready queue without enqueueing or polling", async () => {
  const jobQueue = queue(true);
  const workerLogger = logger();
  const worker = buildWorker({ queue: jobQueue, logger: workerLogger });

  await worker.start();
  await worker.close();
  await worker.close();

  expect(jobQueue.health).toHaveBeenCalledTimes(1);
  expect(jobQueue.enqueue).not.toHaveBeenCalled();
  expect(workerLogger.info).toHaveBeenCalledTimes(1);
  expect(workerLogger.info).toHaveBeenCalledWith("worker.ready", {
    approval_expiry_processed: false,
    approval_expiry_count: 0,
    forecast_processed: false,
    forecast_run_id: null,
    forecast_status: null,
    optimizer_processed: false,
    optimizer_run_id: null,
    optimizer_status: null,
    backtest_processed: false,
    backtest_run_id: null,
    backtest_status: null,
  });
});

it("processes one forecast run when an injected forecast worker is available", async () => {
  const jobQueue = queue(true);
  const workerLogger = logger();
  const forecasts = {
    processNextForecastRun: vi.fn(async () => ({
      processed: true as const,
      runId: "forecast-run-1",
      status: "completed" as const,
      outputUri: "forecasts/forecast-run-1/seasonal-naive-v1.json",
      warnings: [],
    })),
  };
  const worker = buildWorker({ queue: jobQueue, logger: workerLogger, forecasts });

  await worker.start();

  expect(forecasts.processNextForecastRun).toHaveBeenCalledTimes(1);
  expect(workerLogger.info).toHaveBeenCalledWith("worker.ready", {
    approval_expiry_processed: false,
    approval_expiry_count: 0,
    forecast_processed: true,
    forecast_run_id: "forecast-run-1",
    forecast_status: "completed",
    optimizer_processed: false,
    optimizer_run_id: null,
    optimizer_status: null,
    backtest_processed: false,
    backtest_run_id: null,
    backtest_status: null,
  });
});

it("processes one optimizer run when an injected optimizer worker is available", async () => {
  const jobQueue = queue(true);
  const workerLogger = logger();
  const optimizers = {
    processNextOptimizerRun: vi.fn(async () => ({
      processed: true as const,
      runId: "optimizer-run-1",
      status: "completed" as const,
      outputUri: "optimizer-runs/optimizer-run-1/output.json",
      frontierUri: "optimizer-runs/optimizer-run-1/frontier.json",
      recommendationCount: 1,
    })),
  };
  const worker = buildWorker({ queue: jobQueue, logger: workerLogger, optimizers });

  await worker.start();

  expect(optimizers.processNextOptimizerRun).toHaveBeenCalledTimes(1);
  expect(workerLogger.info).toHaveBeenCalledWith("worker.ready", {
    approval_expiry_processed: false,
    approval_expiry_count: 0,
    forecast_processed: false,
    forecast_run_id: null,
    forecast_status: null,
    optimizer_processed: true,
    optimizer_run_id: "optimizer-run-1",
    optimizer_status: "completed",
    backtest_processed: false,
    backtest_run_id: null,
    backtest_status: null,
  });
});

it("processes expired approvals when an injected approval worker is available", async () => {
  const jobQueue = queue(true);
  const workerLogger = logger();
  const approvals = {
    processExpiredApprovals: vi.fn(async () => ({
      processed: true,
      approvalIds: ["approval-1", "approval-2"],
      recommendationIds: ["recommendation-1", "recommendation-2"],
    })),
  };
  const worker = buildWorker({ queue: jobQueue, logger: workerLogger, approvals });

  await worker.start();

  expect(approvals.processExpiredApprovals).toHaveBeenCalledTimes(1);
  expect(workerLogger.info).toHaveBeenCalledWith("worker.ready", {
    approval_expiry_processed: true,
    approval_expiry_count: 2,
    forecast_processed: false,
    forecast_run_id: null,
    forecast_status: null,
    optimizer_processed: false,
    optimizer_run_id: null,
    optimizer_status: null,
    backtest_processed: false,
    backtest_run_id: null,
    backtest_status: null,
  });
});

it("processes one backtest run when an injected backtest worker is available", async () => {
  const jobQueue = queue(true);
  const workerLogger = logger();
  const backtests = {
    processNextBacktest: vi.fn(async () => ({
      processed: true as const,
      runId: "backtest-run-1",
      status: "completed" as const,
      outputUri: "backtests/backtest-run-1/output.json",
      reportSnapshotCreated: true,
    })),
  };
  const worker = buildWorker({ queue: jobQueue, logger: workerLogger, backtests });

  await worker.start();

  expect(backtests.processNextBacktest).toHaveBeenCalledTimes(1);
  expect(workerLogger.info).toHaveBeenCalledWith("worker.ready", {
    approval_expiry_processed: false,
    approval_expiry_count: 0,
    forecast_processed: false,
    forecast_run_id: null,
    forecast_status: null,
    optimizer_processed: false,
    optimizer_run_id: null,
    optimizer_status: null,
    backtest_processed: true,
    backtest_run_id: "backtest-run-1",
    backtest_status: "completed",
  });
});
