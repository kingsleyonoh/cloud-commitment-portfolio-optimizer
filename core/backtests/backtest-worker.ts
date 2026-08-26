import type { ObjectStore } from "../shared/objectStore.js";
import type { BacktestsRepository } from "./backtests-repository.js";
import type { BacktestUsageMonth, BacktestWorkerRun } from "./backtests-types.js";

export interface BacktestWorker {
  processNextBacktest(): Promise<BacktestWorkerResult>;
}

export type BacktestWorkerResult =
  | Readonly<{ processed: false }>
  | Readonly<{
      processed: true;
      runId: string;
      status: "completed" | "failed";
      outputUri: string | null;
      reportSnapshotCreated: boolean;
    }>;

export function createBacktestWorker(
  repository: BacktestsRepository,
  objectStore: ObjectStore,
): BacktestWorker {
  return {
    processNextBacktest: () => processNext(repository, objectStore),
  };
}

async function processNext(
  repository: BacktestsRepository,
  objectStore: ObjectStore,
): Promise<BacktestWorkerResult> {
  const run = await repository.claimNextQueuedBacktest();
  if (!run) return { processed: false };
  try {
    const inputSnapshot = await readJson(objectStore, run.inputSnapshotUri);
    const months = await repository.listReplayUsageMonths(run);
    const artifact = buildBacktestArtifact(run, inputSnapshot, months);
    const outputUri = `backtests/${run.id}/output.json`;
    await objectStore.put(outputUri, bytes(artifact));
    await repository.completeBacktest(run, outputUri, artifact.metrics, reportSnapshot(artifact));
    return {
      processed: true,
      runId: run.id,
      status: "completed",
      outputUri,
      reportSnapshotCreated: true,
    };
  } catch {
    await repository.failBacktest(run.id, "BACKTEST_WORKER_FAILED");
    return {
      processed: true,
      runId: run.id,
      status: "failed",
      outputUri: null,
      reportSnapshotCreated: false,
    };
  }
}

type ReplayBaseline = "no_commitment" | "last_month_steady_state" | "seventy_percent_utilization";

type ReplayMonth = Readonly<{
  month: string;
  on_demand_cost_cents: string;
  realized_cost_cents: string;
  simulated_commitment_cents: string;
  simulated_cost_cents: string;
  simulated_savings_cents: string;
  regret_cents: string;
  decision_inputs: {
    prior_months_seen: number;
    latest_visible_month: string | null;
  };
}>;

type ReplayResult = Readonly<{
  baseline: ReplayBaseline;
  total_on_demand_cost_cents: string;
  total_realized_cost_cents: string;
  simulated_total_cost_cents: string;
  simulated_savings_cents: string;
  regret_cents: string;
  downside_loss_cents: string;
  monthly_results: readonly ReplayMonth[];
}>;

type BacktestArtifact = Readonly<{
  schema_version: "backtest-run-output:v1";
  backtest_run_id: string;
  input_snapshot: Record<string, unknown>;
  replay_window: { start: string; end: string };
  metrics: Record<string, unknown>;
  baseline_results: readonly ReplayResult[];
}>;

export function buildBacktestArtifact(
  run: BacktestWorkerRun,
  inputSnapshot: Record<string, unknown>,
  usageMonths: readonly BacktestUsageMonth[],
): BacktestArtifact {
  const months = monthlyTotals(usageMonths);
  const discountBps = backtestDiscountBps(inputSnapshot);
  const baselineResults = [
    replayBaseline("no_commitment", months, discountBps),
    replayBaseline("last_month_steady_state", months, discountBps),
    replayBaseline("seventy_percent_utilization", months, discountBps),
  ];
  const selected = baselineResults.find((result) => result.baseline === run.baseline);
  const best = baselineResults.reduce((current, candidate) =>
    BigInt(candidate.simulated_savings_cents) > BigInt(current.simulated_savings_cents)
      ? candidate
      : current,
  );
  const metrics = {
    baseline: run.baseline,
    replay_months: months.length,
    source_line_items: usageMonths.reduce((sum, month) => sum + month.lineItemCount, 0),
    total_on_demand_cost_cents: total(months.map((month) => month.onDemandCostCents)).toString(),
    selected_simulated_savings_cents: selected?.simulated_savings_cents ?? "0",
    selected_regret_cents: selected?.regret_cents ?? "0",
    selected_downside_loss_cents: selected?.downside_loss_cents ?? "0",
    best_baseline: best.baseline,
    best_simulated_savings_cents: best.simulated_savings_cents,
    no_future_leakage: true,
  };
  return {
    schema_version: "backtest-run-output:v1",
    backtest_run_id: run.id,
    input_snapshot: inputSnapshot,
    replay_window: { start: run.windowStart, end: run.windowEnd },
    metrics,
    baseline_results: baselineResults,
  };
}

function replayBaseline(
  baseline: ReplayBaseline,
  months: readonly MonthlyTotal[],
  discountBps: bigint,
): ReplayResult {
  const monthlyResults: ReplayMonth[] = [];
  const priorActuals: bigint[] = [];
  for (const month of months) {
    const commitment = commitmentForBaseline(baseline, priorActuals);
    const simulatedMonthCost = simulatedCost(month.onDemandCostCents, commitment, discountBps);
    const savings = month.onDemandCostCents - simulatedMonthCost;
    monthlyResults.push({
      month: month.month,
      on_demand_cost_cents: month.onDemandCostCents.toString(),
      realized_cost_cents: month.realizedCostCents.toString(),
      simulated_commitment_cents: commitment.toString(),
      simulated_cost_cents: simulatedMonthCost.toString(),
      simulated_savings_cents: savings.toString(),
      regret_cents: savings < 0n ? (-savings).toString() : "0",
      decision_inputs: {
        prior_months_seen: priorActuals.length,
        latest_visible_month: months[monthlyResults.length - 1]?.month ?? null,
      },
    });
    priorActuals.push(month.onDemandCostCents);
  }
  const onDemand = total(months.map((month) => month.onDemandCostCents));
  const realized = total(months.map((month) => month.realizedCostCents));
  const simulated = total(monthlyResults.map((month) => BigInt(month.simulated_cost_cents)));
  const savings = total(monthlyResults.map((month) => BigInt(month.simulated_savings_cents)));
  const regret = total(monthlyResults.map((month) => BigInt(month.regret_cents)));
  return {
    baseline,
    total_on_demand_cost_cents: onDemand.toString(),
    total_realized_cost_cents: realized.toString(),
    simulated_total_cost_cents: simulated.toString(),
    simulated_savings_cents: savings.toString(),
    regret_cents: regret.toString(),
    downside_loss_cents: regret.toString(),
    monthly_results: monthlyResults,
  };
}

function commitmentForBaseline(baseline: ReplayBaseline, priorActuals: readonly bigint[]): bigint {
  if (baseline === "no_commitment" || priorActuals.length === 0) return 0n;
  const prior = baseline === "last_month_steady_state" ? priorActuals.at(-1)! : mean(priorActuals);
  return baseline === "seventy_percent_utilization" ? (prior * 70n) / 100n : prior;
}

function simulatedCost(
  onDemandCostCents: bigint,
  commitmentCents: bigint,
  discountBps: bigint,
): bigint {
  if (commitmentCents === 0n) return onDemandCostCents;
  const covered = onDemandCostCents < commitmentCents ? onDemandCostCents : commitmentCents;
  const uncovered = onDemandCostCents - covered;
  const committedCost = (commitmentCents * (10_000n - discountBps) + 5_000n) / 10_000n;
  return uncovered + committedCost;
}

type MonthlyTotal = Readonly<{
  month: string;
  onDemandCostCents: bigint;
  realizedCostCents: bigint;
}>;

function monthlyTotals(usageMonths: readonly BacktestUsageMonth[]): MonthlyTotal[] {
  const totals = new Map<string, { onDemandCostCents: bigint; realizedCostCents: bigint }>();
  for (const month of usageMonths) {
    const current = totals.get(month.month) ?? { onDemandCostCents: 0n, realizedCostCents: 0n };
    current.onDemandCostCents += BigInt(month.onDemandCostCents);
    current.realizedCostCents += BigInt(month.realizedCostCents);
    totals.set(month.month, current);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => Object.freeze({ month, ...values }));
}

function backtestDiscountBps(snapshot: Record<string, unknown>): bigint {
  const policy = objectAt(snapshot, "policy");
  const config = objectAt(policy, "config");
  const value = config.backtest_discount_bps;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000) {
    return BigInt(value);
  }
  return 3000n;
}

function reportSnapshot(artifact: BacktestArtifact): Record<string, unknown> {
  return {
    contract_version: "backtest_summary:v1",
    backtest_run_id: artifact.backtest_run_id,
    replay_window: artifact.replay_window,
    metrics: artifact.metrics,
  };
}

async function readJson(objectStore: ObjectStore, key: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse((await objectStore.get(key)).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function bytes(payload: Record<string, unknown>): Uint8Array {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
}

function total(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

function mean(values: readonly bigint[]): bigint {
  const sum = total(values);
  const count = BigInt(values.length);
  return (sum + count / 2n) / count;
}

function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
