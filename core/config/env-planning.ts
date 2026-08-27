import type { AppConfig, EnvironmentSource } from "./env-schema.js";
import { integerValue, numberValue, oneOf, required } from "./env-values.js";

export function parseImports(source: EnvironmentSource): AppConfig["imports"] {
  return {
    maxSizeMb: integerValue(source, "MAX_IMPORT_SIZE_MB", 1024, 1, 102_400),
    workerConcurrency: integerValue(source, "IMPORT_WORKER_CONCURRENCY", 2, 1, 128),
    priceFixturePath: required(source, "PRICE_FIXTURE_PATH", "tests/fixtures/pricing"),
    priceTableStaleDays: integerValue(source, "PRICE_TABLE_STALE_DAYS", 90, 1, 3650),
  };
}

export function parseForecasting(source: EnvironmentSource): AppConfig["forecasting"] {
  return {
    defaultMethod: oneOf(
      source,
      "DEFAULT_FORECAST_METHOD",
      [
        "seasonal_naive",
        "exponential_smoothing",
        "quantile_bootstrap",
        "scenario_override",
      ] as const,
      "quantile_bootstrap",
    ),
    minHistoryDays: integerValue(source, "MIN_HISTORY_DAYS", 90, 1, 3650),
    randomSeed: integerValue(
      source,
      "FORECAST_RANDOM_SEED",
      20_260_616,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    workerConcurrency: integerValue(source, "FORECAST_WORKER_CONCURRENCY", 2, 1, 128),
  };
}

export function parseOptimizer(source: EnvironmentSource): AppConfig["optimizer"] {
  return {
    maxCandidates: integerValue(source, "OPTIMIZER_MAX_CANDIDATES", 10_000, 1, 10_000_000),
    timeoutSeconds: integerValue(source, "OPTIMIZER_TIMEOUT_SECONDS", 30, 1, 3600),
    downsideConfidence: numberValue(source, "DEFAULT_DOWNSIDE_CONFIDENCE", 0.95, 0, 1),
    maxParallelRuns: integerValue(source, "MAX_PARALLEL_OPTIMIZER_RUNS", 2, 1, 128),
  };
}

export function parseBacktest(source: EnvironmentSource): AppConfig["backtest"] {
  return {
    maxMonths: integerValue(source, "BACKTEST_MAX_MONTHS", 24, 1, 1200),
    workerConcurrency: integerValue(source, "BACKTEST_WORKER_CONCURRENCY", 1, 1, 128),
    randomSeed: integerValue(source, "REPLAY_RANDOM_SEED", 20_260_616, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function parseApprovals(source: EnvironmentSource): AppConfig["approvals"] {
  return { expiryHours: integerValue(source, "APPROVAL_EXPIRY_HOURS", 168, 1, 8760) };
}
