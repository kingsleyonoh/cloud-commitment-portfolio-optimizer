import type { ObjectStore } from "../shared/objectStore.js";
import type { OptimizerRunsRepository } from "./optimizer-runs-repository.js";
import type {
  OptimizerPriceItem,
  OptimizerRecommendationInput,
  OptimizerWorkerRun,
} from "./optimizer-runs-types.js";

export interface OptimizerWorker {
  processNextOptimizerRun(): Promise<OptimizerWorkerResult>;
}

export type OptimizerWorkerResult =
  | Readonly<{ processed: false }>
  | Readonly<{
      processed: true;
      runId: string;
      status: "completed" | "failed" | "infeasible";
      outputUri: string | null;
      frontierUri: string | null;
      recommendationCount: number;
    }>;

interface ForecastPoint {
  month: string;
  provider: "aws";
  service_code: string;
  region: string;
  forecast_on_demand_cost_cents: string;
}

export type AwsComputeSavingsPlanCandidate = Readonly<{
  provider: "aws";
  instrument: "aws_compute_savings_plan";
  service_code: string;
  region: string;
  term_months: number;
  payment_option: string;
  commitment_amount_cents: string;
  expected_savings_cents: string;
  p95_downside_loss_cents: string;
  utilization_p50_pct: string;
  utilization_p95_pct: string;
  confidence_score: string;
  risk_band: "low" | "medium" | "high" | "blocked";
  feasible: boolean;
  binding_constraints: readonly string[];
}>;

const HOURS_PER_MONTH = 730n;

export function createOptimizerWorker(
  repository: OptimizerRunsRepository,
  objectStore: ObjectStore,
): OptimizerWorker {
  return {
    processNextOptimizerRun: () => processNext(repository, objectStore),
  };
}

async function processNext(
  repository: OptimizerRunsRepository,
  objectStore: ObjectStore,
): Promise<OptimizerWorkerResult> {
  const run = await repository.claimNextQueuedOptimizerRun();
  if (!run) return { processed: false };
  try {
    const snapshot = await readJson(objectStore, run.inputSnapshotUri);
    const forecastUri = forecastOutputUri(snapshot);
    const forecast = await readJson(objectStore, forecastUri);
    const priceItems = await repository.listFrozenPriceItems(run);
    const candidates = optimizeAwsComputeSavingsPlan(run, snapshot, forecast, priceItems);
    const feasible = candidates.filter((candidate) => candidate.feasible);
    const selected = feasible[0] ?? null;
    const frontier = buildFrontier(run, candidates, selected);
    const frontierUri = `optimizer-runs/${run.id}/frontier.json`;
    await objectStore.put(frontierUri, bytes(frontier));
    if (!selected) {
      const details = infeasibilityDetails(candidates);
      await repository.markOptimizerRunInfeasible(run.id, frontierUri, details);
      return {
        processed: true,
        runId: run.id,
        status: "infeasible",
        outputUri: null,
        frontierUri,
        recommendationCount: 0,
      };
    }
    const outputUri = `optimizer-runs/${run.id}/output.json`;
    const output = buildOutput(run, selected);
    await objectStore.put(outputUri, bytes(output));
    await repository.insertRecommendation(run, recommendationInput(run, snapshot, selected));
    await repository.completeOptimizerRun(run.id, outputUri, frontierUri);
    return {
      processed: true,
      runId: run.id,
      status: "completed",
      outputUri,
      frontierUri,
      recommendationCount: 1,
    };
  } catch {
    await repository.failOptimizerRun(run.id, "OPTIMIZER_WORKER_FAILED");
    return {
      processed: true,
      runId: run.id,
      status: "failed",
      outputUri: null,
      frontierUri: null,
      recommendationCount: 0,
    };
  }
}

export function optimizeAwsComputeSavingsPlan(
  run: OptimizerWorkerRun,
  snapshot: Record<string, unknown>,
  forecast: Record<string, unknown>,
  priceItems: readonly OptimizerPriceItem[],
): AwsComputeSavingsPlanCandidate[] {
  const points = forecastPoints(forecast).filter(
    (point) => point.provider === run.provider && point.region.length > 0,
  );
  const policy = policySnapshot(snapshot);
  return priceItems
    .flatMap((item) => evaluateItem(run, policy, pointsForItem(points, item), item))
    .sort(compareCandidates);
}

function evaluateItem(
  run: OptimizerWorkerRun,
  policy: PolicySnapshot,
  points: readonly ForecastPoint[],
  item: OptimizerPriceItem,
): AwsComputeSavingsPlanCandidate[] {
  if (points.length === 0) return [];
  const eligibleCosts = points
    .map((point) => BigInt(point.forecast_on_demand_cost_cents))
    .sort(sortBigInt);
  const commitment = percentile(eligibleCosts, 50);
  const monthlyEffectiveCost = BigInt(item.hourlyRateCents) * HOURS_PER_MONTH;
  const upfrontAmortization = roundedDiv(BigInt(item.upfrontCents), BigInt(item.termMonths));
  const liquidityPenalty = roundedDiv(
    BigInt(item.upfrontCents) * BigInt(policy.liquidityPenaltyBps),
    10_000n,
  );
  const nets = eligibleCosts.map((cost) => {
    const unusedWaste = commitment > cost ? commitment - cost : 0n;
    return cost - monthlyEffectiveCost - unusedWaste - upfrontAmortization - liquidityPenalty;
  });
  const downside = nets.map((value) => (value < 0n ? -value : 0n)).sort(sortBigInt);
  const expected = meanRounded(nets);
  const p95Downside = percentile(downside, 95);
  const utilizations = eligibleCosts.map((cost) =>
    commitment === 0n ? 0n : (minBigInt(cost, commitment) * 10_000n) / commitment,
  );
  const utilizationP50 = percentile(utilizations.sort(sortBigInt), 50);
  const utilizationP95 = percentile(utilizations.sort(sortBigInt), 95);
  const utilizationGapBps = 10_000n - utilizationP50;
  const binding = bindingConstraints(policy, expected, p95Downside, utilizationGapBps);
  const feasible = binding.length === 0;
  return [
    {
      provider: run.provider,
      instrument: run.instrument,
      service_code: serviceCode(points[0]!, item),
      region: item.region,
      term_months: item.termMonths,
      payment_option: item.paymentOption,
      commitment_amount_cents: commitment.toString(),
      expected_savings_cents: expected > 0n ? expected.toString() : "0",
      p95_downside_loss_cents: p95Downside.toString(),
      utilization_p50_pct: formatBps(utilizationP50),
      utilization_p95_pct: formatBps(utilizationP95),
      confidence_score: "0.9000",
      risk_band: riskBand(p95Downside, policy.maxDownsideLossCents),
      feasible,
      binding_constraints: binding,
    },
  ];
}

function pointsForItem(
  points: readonly ForecastPoint[],
  item: OptimizerPriceItem,
): readonly ForecastPoint[] {
  return points.filter(
    (point) =>
      point.region === item.region &&
      (!coverageServiceCode(item) || point.service_code === coverageServiceCode(item)),
  );
}

function recommendationInput(
  run: OptimizerWorkerRun,
  snapshot: Record<string, unknown>,
  selected: AwsComputeSavingsPlanCandidate,
): OptimizerRecommendationInput {
  const policy = policySnapshot(snapshot);
  const approvalRequired =
    BigInt(selected.commitment_amount_cents) >= policy.approvalThresholdCents;
  return {
    recommendationType: "buy",
    provider: selected.provider,
    instrument: selected.instrument,
    serviceCode: selected.service_code,
    region: selected.region,
    termMonths: selected.term_months,
    commitmentAmountCents: selected.commitment_amount_cents,
    expectedSavingsCents: selected.expected_savings_cents,
    p95DownsideLossCents: selected.p95_downside_loss_cents,
    utilizationP50Pct: selected.utilization_p50_pct,
    utilizationP95Pct: selected.utilization_p95_pct,
    confidenceScore: selected.confidence_score,
    riskBand: selected.risk_band,
    status: approvalRequired ? "pending_approval" : "ready",
    approvalRequired,
    explanation: {
      baseline_name: "on_demand",
      binding_constraints: ["risk_budget"],
      price_table_version_ids: run.priceTableVersionIds,
      frontier_uri: `optimizer-runs/${run.id}/frontier.json`,
    },
  };
}

function buildOutput(
  run: OptimizerWorkerRun,
  selected: AwsComputeSavingsPlanCandidate,
): Record<string, unknown> {
  return {
    schema_version: "optimizer-run-output:v1",
    optimizer_run_id: run.id,
    selected_candidate: selected,
  };
}

function buildFrontier(
  run: OptimizerWorkerRun,
  candidates: readonly AwsComputeSavingsPlanCandidate[],
  selected: AwsComputeSavingsPlanCandidate | null,
): Record<string, unknown> {
  const bestExpected = maxBigInt(
    candidates.map((candidate) => BigInt(candidate.expected_savings_cents)),
  );
  const lowestDownside = minBigInt(
    candidates.map((candidate) => BigInt(candidate.p95_downside_loss_cents)),
  );
  return {
    schema_version: "optimizer-frontier:v1",
    optimizer_run_id: run.id,
    summary: {
      candidate_count: candidates.length,
      feasible_count: candidates.filter((candidate) => candidate.feasible).length,
      best_expected_savings_cents: bestExpected.toString(),
      lowest_p95_downside_loss_cents: lowestDownside.toString(),
      selected_expected_savings_cents: selected?.expected_savings_cents ?? null,
      selected_p95_downside_loss_cents: selected?.p95_downside_loss_cents ?? null,
    },
    points: candidates,
  };
}

function infeasibilityDetails(
  candidates: readonly AwsComputeSavingsPlanCandidate[],
): Record<string, unknown> {
  const lowestDownside = minBigInt(
    candidates.map((candidate) => BigInt(candidate.p95_downside_loss_cents)),
  );
  return {
    reason: "NO_FEASIBLE_CANDIDATES",
    ranked_relaxations: [
      { field: "min_expected_savings_cents", suggested_value: "0" },
      { field: "max_downside_loss_cents", suggested_value: lowestDownside.toString() },
    ],
  };
}

interface PolicySnapshot {
  maxDownsideLossCents: bigint;
  minExpectedSavingsCents: bigint;
  maxUtilizationGapBps: bigint;
  approvalThresholdCents: bigint;
  liquidityPenaltyBps: number;
}

function policySnapshot(snapshot: Record<string, unknown>): PolicySnapshot {
  const policy = objectAt(snapshot, "policy");
  const config = objectAt(policy, "config");
  return {
    maxDownsideLossCents: BigInt(stringAt(policy, "maxDownsideLossCents")),
    minExpectedSavingsCents: BigInt(stringAt(policy, "minExpectedSavingsCents")),
    maxUtilizationGapBps: decimalPercentToBps(stringAt(policy, "maxUtilizationGapPct")),
    approvalThresholdCents: BigInt(stringAt(policy, "approvalThresholdCents")),
    liquidityPenaltyBps: integerAt(config, "liquidity_penalty_bps", 0),
  };
}

function forecastOutputUri(snapshot: Record<string, unknown>): string {
  const forecastRun = objectAt(snapshot, "forecast_run");
  return stringAt(forecastRun, "outputUri");
}

function forecastPoints(forecast: Record<string, unknown>): ForecastPoint[] {
  const value = forecast.forecast_points;
  if (!Array.isArray(value)) return [];
  return value.map((point) => {
    const row = point && typeof point === "object" ? (point as Record<string, unknown>) : {};
    return {
      month: stringAt(row, "month"),
      provider: "aws",
      service_code: stringAt(row, "service_code"),
      region: stringAt(row, "region"),
      forecast_on_demand_cost_cents: stringAt(row, "forecast_on_demand_cost_cents"),
    };
  });
}

async function readJson(objectStore: ObjectStore, key: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse((await objectStore.get(key)).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function bytes(payload: Record<string, unknown>): Uint8Array {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
}

function bindingConstraints(
  policy: PolicySnapshot,
  expected: bigint,
  p95Downside: bigint,
  utilizationGapBps: bigint,
): readonly string[] {
  const values: string[] = [];
  if (p95Downside > policy.maxDownsideLossCents) values.push("risk_budget");
  if (expected < policy.minExpectedSavingsCents) values.push("minimum_expected_savings");
  if (utilizationGapBps > policy.maxUtilizationGapBps) values.push("utilization_gap");
  return Object.freeze(values);
}

function riskBand(
  p95Downside: bigint,
  maxDownsideLossCents: bigint,
): "low" | "medium" | "high" | "blocked" {
  if (p95Downside === 0n) return "low";
  return p95Downside <= maxDownsideLossCents ? "medium" : "high";
}

function compareCandidates(
  left: AwsComputeSavingsPlanCandidate,
  right: AwsComputeSavingsPlanCandidate,
): number {
  if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
  const expected = BigInt(right.expected_savings_cents) - BigInt(left.expected_savings_cents);
  if (expected !== 0n) return expected > 0n ? 1 : -1;
  const downside = BigInt(left.p95_downside_loss_cents) - BigInt(right.p95_downside_loss_cents);
  return downside === 0n ? 0 : downside > 0n ? 1 : -1;
}

function serviceCode(point: ForecastPoint, item: OptimizerPriceItem): string {
  return coverageServiceCode(item) ?? point.service_code;
}

function coverageServiceCode(item: OptimizerPriceItem): string | null {
  const value = item.coverageRules.service_code ?? item.coverageRules.service;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function percentile(values: readonly bigint[], pct: number): bigint {
  if (values.length === 0) return 0n;
  const index = Math.max(0, Math.ceil((pct / 100) * values.length) - 1);
  return values[index]!;
}

function meanRounded(values: readonly bigint[]): bigint {
  if (values.length === 0) return 0n;
  const total = values.reduce((sum, value) => sum + value, 0n);
  return roundedDiv(total, BigInt(values.length));
}

function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  if (numerator >= 0n) return (numerator + denominator / 2n) / denominator;
  return -((-numerator + denominator / 2n) / denominator);
}

function decimalPercentToBps(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function formatBps(value: bigint): string {
  const whole = value / 100n;
  const fraction = value % 100n;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "0";
}

function integerAt(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return Number.isInteger(value) ? (value as number) : fallback;
}

function sortBigInt(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? 1 : -1;
}

function minBigInt(left: bigint, right: bigint): bigint;
function minBigInt(values: readonly bigint[]): bigint;
function minBigInt(leftOrValues: bigint | readonly bigint[], right?: bigint): bigint {
  if (typeof leftOrValues === "bigint") return leftOrValues < right! ? leftOrValues : right!;
  const [first, ...rest] = leftOrValues;
  return rest.reduce((minimum, value) => (value < minimum ? value : minimum), first ?? 0n);
}

function maxBigInt(values: readonly bigint[]): bigint {
  const [first, ...rest] = values;
  return rest.reduce((maximum, value) => (value > maximum ? value : maximum), first ?? 0n);
}
