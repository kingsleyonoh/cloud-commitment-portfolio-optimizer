import type { ObjectStore } from "../shared/objectStore.js";
import type { ForecastRepository } from "./forecast-repository.js";
import type { ForecastUsageMonth, ForecastWorkerRun } from "./forecast-types.js";

export interface ForecastWorker {
  processNextForecastRun(): Promise<ForecastWorkerResult>;
}

export type ForecastWorkerResult =
  | Readonly<{ processed: false }>
  | Readonly<{
      processed: true;
      runId: string;
      status: "completed" | "failed";
      outputUri: string | null;
      warnings: readonly string[];
    }>;

export interface ForecastWorkerOptions {
  minHistoryDays: number;
}

type DimensionKey = `${string}\u0000${string}\u0000${string}`;

interface ForecastPoint {
  month: string;
  provider: string;
  service_code: string;
  region: string;
  forecast_on_demand_cost_cents: string;
  basis: "seasonal_month" | "all_history_average";
}

export function createForecastWorker(
  repository: ForecastRepository,
  objectStore: ObjectStore,
  options: ForecastWorkerOptions,
): ForecastWorker {
  return {
    processNextForecastRun: () => processNext(repository, objectStore, options),
  };
}

async function processNext(
  repository: ForecastRepository,
  objectStore: ObjectStore,
  options: ForecastWorkerOptions,
): Promise<ForecastWorkerResult> {
  const run = await repository.claimNextQueuedRun();
  if (!run) return { processed: false };
  try {
    const months = await repository.listUsageMonths(run);
    const artifact = buildSeasonalNaiveArtifact(run, months, options.minHistoryDays);
    const outputUri = `forecasts/${run.id}/seasonal-naive-v1.json`;
    await objectStore.put(outputUri, Buffer.from(JSON.stringify(artifact), "utf8"));
    await repository.completeRun(run.id, outputUri, artifact.quality_metrics);
    return {
      processed: true,
      runId: run.id,
      status: "completed",
      outputUri,
      warnings: artifact.quality_metrics.warnings,
    };
  } catch {
    await repository.failRun(run.id, "FORECAST_WORKER_FAILED");
    return {
      processed: true,
      runId: run.id,
      status: "failed",
      outputUri: null,
      warnings: [],
    };
  }
}

function buildSeasonalNaiveArtifact(
  run: ForecastWorkerRun,
  months: readonly ForecastUsageMonth[],
  minHistoryDays: number,
) {
  const historyDays = inclusiveDays(run.inputWindowStart, run.inputWindowEnd);
  const observedMonths = new Set(months.map((month) => month.month));
  const totalLineItems = months.reduce((sum, month) => sum + month.lineItemCount, 0);
  const warnings = qualityWarnings(
    historyDays,
    observedMonths.size,
    totalLineItems,
    minHistoryDays,
  );
  const dimensions = dimensionsByKey(months);
  const forecast_months = forecastMonths(run.inputWindowEnd, run.horizonMonths);
  const forecast_points = [...dimensions.entries()].flatMap(([key, history]) =>
    forecast_months.map((month) => forecastPoint(key, history, month)),
  );

  return {
    schema_version: "forecast_distribution:seasonal_naive:v1",
    forecast_run_id: run.id,
    forecast_model_id: run.forecastModelId,
    method: run.model.method,
    input_window: {
      start: run.inputWindowStart,
      end: run.inputWindowEnd,
    },
    horizon_months: run.horizonMonths,
    random_seed: run.randomSeed,
    quality_metrics: {
      method: run.model.method,
      history_days: historyDays,
      monthly_observations: observedMonths.size,
      source_line_items: totalLineItems,
      forecast_points: forecast_points.length,
      confidence: warnings.length === 0 ? "high" : "low",
      warnings,
    },
    forecast_points,
  } as const;
}

function qualityWarnings(
  historyDays: number,
  monthlyObservations: number,
  lineItems: number,
  minHistoryDays: number,
): string[] {
  const warnings: string[] = [];
  if (lineItems === 0) warnings.push("NO_ELIGIBLE_USAGE_HISTORY");
  if (historyDays < minHistoryDays) warnings.push("LOW_HISTORY_DAYS");
  if (monthlyObservations < 3) warnings.push("LOW_MONTHLY_OBSERVATIONS");
  return warnings;
}

function dimensionsByKey(
  months: readonly ForecastUsageMonth[],
): Map<DimensionKey, ForecastUsageMonth[]> {
  const dimensions = new Map<DimensionKey, ForecastUsageMonth[]>();
  for (const month of months) {
    const key = dimensionKey(month);
    const history = dimensions.get(key) ?? [];
    history.push(month);
    dimensions.set(key, history);
  }
  return dimensions;
}

function forecastPoint(
  key: DimensionKey,
  history: readonly ForecastUsageMonth[],
  month: string,
): ForecastPoint {
  const seasonal = history.filter((entry) => entry.month.slice(5, 7) === month.slice(5, 7));
  const basisRows = seasonal.length > 0 ? seasonal : history;
  const [provider, serviceCode, region] = key.split("\u0000") as [string, string, string];
  return {
    month,
    provider,
    service_code: serviceCode,
    region,
    forecast_on_demand_cost_cents: averageCents(basisRows),
    basis: seasonal.length > 0 ? "seasonal_month" : "all_history_average",
  };
}

function averageCents(months: readonly ForecastUsageMonth[]): string {
  const total = months.reduce((sum, month) => sum + BigInt(month.onDemandCostCents), 0n);
  const count = BigInt(months.length);
  return ((total + count / 2n) / count).toString();
}

function forecastMonths(inputWindowEnd: string, horizonMonths: number): string[] {
  const [year, month] = inputWindowEnd.split("-").map(Number);
  const start = new Date(Date.UTC(year!, month!, 1));
  return Array.from({ length: horizonMonths }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    return date.toISOString().slice(0, 7);
  });
}

function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function dimensionKey(month: ForecastUsageMonth): DimensionKey {
  return `${month.provider}\u0000${month.serviceCode}\u0000${month.region}`;
}
