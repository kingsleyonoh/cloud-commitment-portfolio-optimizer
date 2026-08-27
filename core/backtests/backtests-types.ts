export type BacktestBaseline =
  "no_commitment" | "last_month_steady_state" | "seventy_percent_utilization" | "custom";

export type BacktestRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BacktestCreateInput = Readonly<{
  name: string;
  policyId: string;
  baseline: BacktestBaseline;
  windowStart: string;
  windowEnd: string;
}>;

export type BacktestListInput = Readonly<{
  limit: number;
  status?: BacktestRunStatus;
  baseline?: BacktestBaseline;
  policyId?: string;
}>;

export type BacktestPolicySnapshot = Readonly<{
  id: string;
  status: string;
  name: string;
  objective: string;
  maxDownsideLossCents: string;
  minExpectedSavingsCents: string;
  maxUtilizationGapPct: string;
  approvalThresholdCents: string;
  allowedInstruments: readonly string[];
  config: Record<string, unknown>;
}>;

export type BacktestRunRecord = Readonly<{
  id: string;
  name: string;
  policyId: string;
  baseline: BacktestBaseline;
  windowStart: string;
  windowEnd: string;
  status: BacktestRunStatus;
  inputSnapshotUri: string;
  outputUri: string | null;
  metrics: Record<string, unknown>;
  errorDetails: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type BacktestWorkerRun = BacktestRunRecord & Readonly<{ tenantId: string }>;

export type BacktestUsageMonth = Readonly<{
  month: string;
  provider: "aws" | "azure" | "gcp";
  serviceCode: string;
  region: string;
  onDemandCostCents: string;
  realizedCostCents: string;
  commitmentAppliedCents: string;
  lineItemCount: number;
}>;

export type BacktestRun = Readonly<{
  id: string;
  name: string;
  policy_id: string;
  baseline: BacktestBaseline;
  window_start: string;
  window_end: string;
  status: BacktestRunStatus;
  input_snapshot_uri: string;
  output_uri: string | null;
  metrics: Record<string, unknown>;
  error_details: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}>;

export type BacktestListPage = Readonly<{
  backtests: readonly BacktestRun[];
}>;

export type BacktestDetail = Readonly<{
  backtest: BacktestRun;
}>;

export type BacktestSnapshotInput = BacktestCreateInput &
  Readonly<{
    id: string;
    inputSnapshotUri: string;
    createdByUserId: string | null;
  }>;
