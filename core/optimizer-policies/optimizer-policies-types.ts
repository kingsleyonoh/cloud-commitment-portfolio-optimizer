export type OptimizerPolicyObjective =
  "maximize_expected_savings" | "minimize_downside_loss" | "efficient_frontier";
export type OptimizerPolicyInstrument =
  | "aws_compute_savings_plan"
  | "aws_reserved_instance"
  | "azure_savings_plan"
  | "azure_reservation"
  | "gcp_committed_use_discount";
export type OptimizerPolicyStatus = "draft" | "active" | "archived";

export type OptimizerPolicyRecord = Readonly<{
  id: string;
  name: string;
  objective: OptimizerPolicyObjective;
  maxDownsideLossCents: string;
  minExpectedSavingsCents: string;
  maxUtilizationGapPct: string;
  approvalThresholdCents: string;
  allowedInstruments: readonly OptimizerPolicyInstrument[];
  config: Record<string, unknown>;
  status: OptimizerPolicyStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type OptimizerPolicy = Readonly<{
  id: string;
  name: string;
  objective: OptimizerPolicyObjective;
  max_downside_loss_cents: string;
  min_expected_savings_cents: string;
  max_utilization_gap_pct: string;
  approval_threshold_cents: string;
  allowed_instruments: readonly OptimizerPolicyInstrument[];
  config: Record<string, unknown>;
  status: OptimizerPolicyStatus;
  created_at: string;
  updated_at: string;
}>;

export type OptimizerPolicyListPage = Readonly<{
  optimizer_policies: readonly OptimizerPolicy[];
  next_cursor: string | null;
}>;

export type OptimizerPolicyCursorBoundary = Readonly<{
  createdAt: string;
  id: string;
}>;

export type OptimizerPolicyListInput = Readonly<{
  limit: number;
  cursor?: OptimizerPolicyCursorBoundary;
  status?: OptimizerPolicyStatus;
}>;

export type OptimizerPolicyCreateInput = Readonly<{
  name: string;
  objective: OptimizerPolicyObjective;
  maxDownsideLossCents: string;
  minExpectedSavingsCents: string;
  maxUtilizationGapPct: string;
  approvalThresholdCents: string;
  allowedInstruments: readonly OptimizerPolicyInstrument[];
  config: Record<string, unknown>;
}>;

export type OptimizerPolicyPatchInput = Partial<OptimizerPolicyCreateInput> &
  Readonly<{ status?: OptimizerPolicyStatus }>;
