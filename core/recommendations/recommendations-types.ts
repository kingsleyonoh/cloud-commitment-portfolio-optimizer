export type RecommendationStatus =
  | "draft"
  | "ready"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "superseded"
  | "executed"
  | "expired";

export type RecommendationRiskBand = "low" | "medium" | "high" | "blocked";

export type RecommendationRecord = Readonly<{
  id: string;
  optimizerRunId: string;
  recommendationType:
    "buy" | "renew" | "resize" | "sell_or_exchange" | "no_action" | "manual_review";
  provider: "aws";
  instrument: "aws_compute_savings_plan";
  serviceCode: string;
  region: string;
  termMonths: number;
  commitmentAmountCents: string;
  expectedSavingsCents: string;
  p95DownsideLossCents: string;
  utilizationP50Pct: string;
  utilizationP95Pct: string;
  confidenceScore: string;
  riskBand: RecommendationRiskBand;
  status: RecommendationStatus;
  explanation: Record<string, unknown>;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type Recommendation = Readonly<{
  id: string;
  optimizer_run_id: string;
  recommendation_type: RecommendationRecord["recommendationType"];
  provider: "aws";
  instrument: "aws_compute_savings_plan";
  service_code: string;
  region: string;
  term_months: number;
  commitment_amount_cents: string;
  expected_savings_cents: string;
  p95_downside_loss_cents: string;
  utilization_p50_pct: string;
  utilization_p95_pct: string;
  confidence_score: string;
  risk_band: RecommendationRiskBand;
  status: RecommendationStatus;
  explanation: Record<string, unknown>;
  approval_required: boolean;
  created_at: string;
  updated_at: string;
}>;

export type RecommendationCursorBoundary = Readonly<{ createdAt: string; id: string }>;

export type RecommendationListInput = Readonly<{
  limit: number;
  cursor?: RecommendationCursorBoundary;
  status?: RecommendationStatus;
  riskBand?: RecommendationRiskBand;
  provider?: "aws";
  instrument?: "aws_compute_savings_plan";
  optimizerRunId?: string;
}>;

export type RecommendationListPage = Readonly<{
  recommendations: readonly Recommendation[];
  next_cursor: string | null;
}>;

export type ReportSummaryRecord = Readonly<{
  id: string;
  sourceType: "recommendation";
  sourceId: string;
  status: "queued" | "rendered" | "failed" | "archived";
  renderedHtmlUri: string | null;
  renderedPdfUri: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ReportSummary = Readonly<{
  id: string;
  source_type: "recommendation";
  source_id: string;
  status: ReportSummaryRecord["status"];
  rendered_html_uri: string | null;
  rendered_pdf_uri: string | null;
  created_at: string;
  updated_at: string;
}>;

export type RecommendationDetail = Readonly<{
  recommendation: Recommendation;
  report_summary: ReportSummary | null;
}>;
