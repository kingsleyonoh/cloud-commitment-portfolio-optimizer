import { buildBacktestArtifact } from "../core/backtests/backtest-worker.js";
import { optimizeAwsComputeSavingsPlan } from "../core/optimizer-runs/optimizer-worker.js";
import type { BacktestUsageMonth, BacktestWorkerRun } from "../core/backtests/backtests-types.js";
import type {
  OptimizerPriceItem,
  OptimizerWorkerRun,
} from "../core/optimizer-runs/optimizer-runs-types.js";

const LINE_ITEMS = 1_000_000;
const OPTIMIZER_CANDIDATES = 10_000;
const ITERATIONS = 25;
const REPLAY_LIMIT_MS = 60_000;
const OPTIMIZER_P95_LIMIT_MS = 30_000;

const replayInput = makeReplayInput(LINE_ITEMS);
const replayStart = performance.now();
const replayArtifact = buildBacktestArtifact(
  replayInput.run,
  replayInput.snapshot,
  replayInput.months,
);
const replayMs = performance.now() - replayStart;

const optimizerInput = makeOptimizerInput(OPTIMIZER_CANDIDATES);
optimizeAwsComputeSavingsPlan(
  optimizerInput.run,
  optimizerInput.snapshot,
  optimizerInput.forecast,
  optimizerInput.priceItems,
);
const optimizerDurations = [];
for (let index = 0; index < ITERATIONS; index += 1) {
  const start = performance.now();
  optimizeAwsComputeSavingsPlan(
    optimizerInput.run,
    optimizerInput.snapshot,
    optimizerInput.forecast,
    optimizerInput.priceItems,
  );
  optimizerDurations.push(performance.now() - start);
}
optimizerDurations.sort((left, right) => left - right);
const optimizerP95Ms = optimizerDurations[Math.ceil(optimizerDurations.length * 0.95) - 1] ?? 0;

const result = {
  replay: {
    line_items: replayArtifact.metrics.source_line_items,
    months: replayArtifact.metrics.replay_months,
    duration_ms: round(replayMs),
    limit_ms: REPLAY_LIMIT_MS,
    pass: replayMs < REPLAY_LIMIT_MS,
  },
  optimizer: {
    candidate_items: OPTIMIZER_CANDIDATES,
    iterations: ITERATIONS,
    p95_duration_ms: round(optimizerP95Ms),
    limit_ms: OPTIMIZER_P95_LIMIT_MS,
    pass: optimizerP95Ms < OPTIMIZER_P95_LIMIT_MS,
  },
};
console.log(JSON.stringify(result));

if (!result.replay.pass || !result.optimizer.pass) process.exitCode = 1;

function makeReplayInput(lineItems: number): {
  run: BacktestWorkerRun;
  snapshot: Record<string, unknown>;
  months: readonly BacktestUsageMonth[];
} {
  const months: BacktestUsageMonth[] = [];
  for (let index = 0; index < lineItems; index += 1) {
    months.push({
      month: `2026-${String((index % 12) + 1).padStart(2, "0")}`,
      provider: "aws",
      serviceCode: "AmazonEC2",
      region: "us-east-1",
      onDemandCostCents: "1000",
      realizedCostCents: "900",
      commitmentAppliedCents: "0",
      lineItemCount: 1,
    });
  }
  return {
    run: {
      id: "018c4d40-0000-7000-8000-000000000001",
      tenantId: "018c4d40-0000-7000-8000-000000000002",
      name: "1M-line replay benchmark",
      policyId: "018c4d40-0000-7000-8000-000000000003",
      baseline: "seventy_percent_utilization",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
      status: "running",
      inputSnapshotUri: "backtests/benchmark/input.json",
      outputUri: null,
      metrics: {},
      errorDetails: {},
      createdByUserId: null,
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
    snapshot: { policy: { config: { backtest_discount_bps: 3000 } } },
    months,
  };
}

function makeOptimizerInput(candidateCount: number): {
  run: OptimizerWorkerRun;
  snapshot: Record<string, unknown>;
  forecast: Record<string, unknown>;
  priceItems: readonly OptimizerPriceItem[];
} {
  return {
    run: {
      id: "018c4d40-0000-7000-8000-000000000011",
      tenantId: "018c4d40-0000-7000-8000-000000000012",
      forecastRunId: "018c4d40-0000-7000-8000-000000000013",
      scenarioId: null,
      optimizerPolicyId: "018c4d40-0000-7000-8000-000000000014",
      provider: "aws",
      instrument: "aws_compute_savings_plan",
      priceTableVersionIds: ["018c4d40-0000-7000-8000-000000000015"],
      status: "running",
      randomSeed: "20260826",
      inputSnapshotUri: "optimizer-runs/benchmark/input.json",
      outputUri: null,
      frontierUri: null,
      infeasibilityDetails: {},
      errorDetails: {},
      createdByUserId: null,
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
    snapshot: {
      policy: {
        maxDownsideLossCents: "1000000",
        minExpectedSavingsCents: "1",
        maxUtilizationGapPct: "40.00",
        approvalThresholdCents: "100000000",
        config: { liquidity_penalty_bps: 0 },
      },
    },
    forecast: {
      forecast_points: Array.from({ length: 12 }, (_, index) => ({
        month: `2026-${String(index + 1).padStart(2, "0")}`,
        provider: "aws",
        service_code: "AmazonEC2",
        region: "us-east-1",
        forecast_on_demand_cost_cents: String(600_000 + index * 1_000),
      })),
    },
    priceItems: Array.from({ length: candidateCount }, (_, index) => ({
      sku: `csp-${index}`,
      region: "us-east-1",
      termMonths: 12,
      paymentOption: "no_upfront",
      hourlyRateCents: "600",
      upfrontCents: "0",
      coverageRules: { service_code: "AmazonEC2" },
    })),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
