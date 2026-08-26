export type OptimizerRunProvider = "aws";
export type OptimizerRunInstrument = "aws_compute_savings_plan";
export type OptimizerRunStatus =
  "queued" | "running" | "completed" | "failed" | "infeasible" | "cancelled";

export type OptimizerRunCreateInput = Readonly<{
  forecastRunId: string;
  scenarioId?: string;
  optimizerPolicyId: string;
  provider: OptimizerRunProvider;
  instrument: OptimizerRunInstrument;
  priceTableVersionIds?: readonly string[];
}>;

export type OptimizerRunRecord = Readonly<{
  id: string;
  forecastRunId: string;
  scenarioId: string | null;
  optimizerPolicyId: string;
  provider: OptimizerRunProvider;
  instrument: OptimizerRunInstrument;
  priceTableVersionIds: readonly string[];
  status: OptimizerRunStatus;
  randomSeed: string;
  inputSnapshotUri: string;
  outputUri: string | null;
  frontierUri: string | null;
  infeasibilityDetails: Record<string, unknown>;
  errorDetails: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type OptimizerRun = Readonly<{
  id: string;
  forecast_run_id: string;
  scenario_id: string | null;
  optimizer_policy_id: string;
  provider: OptimizerRunProvider;
  instrument: OptimizerRunInstrument;
  price_table_version_ids: readonly string[];
  status: OptimizerRunStatus;
  random_seed: string;
  input_snapshot_uri: string;
  output_uri: string | null;
  frontier_uri: string | null;
  infeasibility_details: Record<string, unknown>;
  error_details: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}>;

export type OptimizerRunDetail = Readonly<{
  optimizer_run: OptimizerRun;
  frontier_summary: Record<string, unknown> | null;
}>;

export type OptimizerRunSnapshotInput = OptimizerRunCreateInput &
  Readonly<{
    id: string;
    randomSeed: string;
    inputSnapshotUri: string;
    createdByUserId: string | null;
  }>;

export type OptimizerRunForecastSnapshot = Readonly<{
  id: string;
  status: string;
  outputUri: string | null;
  qualityMetrics: Record<string, unknown>;
}>;

export type OptimizerRunPolicySnapshot = Readonly<{
  id: string;
  status: string;
  objective: string;
  maxDownsideLossCents: string;
  minExpectedSavingsCents: string;
  maxUtilizationGapPct: string;
  approvalThresholdCents: string;
  allowedInstruments: readonly string[];
  config: Record<string, unknown>;
}>;

export type OptimizerRunScenarioSnapshot = Readonly<{
  id: string;
  status: string;
  shockConfig: Record<string, unknown>;
}> | null;

export type OptimizerRunPriceSnapshot = Readonly<{
  id: string;
  status: string;
  provider: OptimizerRunProvider;
  instrument: OptimizerRunInstrument;
  checksum: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}>;

export type ResolvedOptimizerRunInputs = Readonly<{
  forecastRun: OptimizerRunForecastSnapshot;
  policy: OptimizerRunPolicySnapshot;
  scenario: OptimizerRunScenarioSnapshot;
  priceTableVersions: readonly OptimizerRunPriceSnapshot[];
}>;
