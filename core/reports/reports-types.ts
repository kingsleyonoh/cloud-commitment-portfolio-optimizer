import type {
  ReportSummary,
  ReportSummaryRecord,
} from "../recommendations/recommendations-types.js";

export type ReportSnapshotRecord = ReportSummaryRecord &
  Readonly<{
    snapshotJson: Record<string, unknown>;
  }>;

export type ReportSnapshot = ReportSummary &
  Readonly<{
    snapshot_json: Record<string, unknown>;
  }>;

export type RecommendationReportData = Readonly<{
  tenant: {
    displayName: string;
    fullLegalName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    supportUrl: string | null;
    financeOwnerEmail: string | null;
  };
  recommendation: {
    id: string;
    recommendationType: string;
    provider: "aws" | "azure" | "gcp";
    instrument:
      | "aws_compute_savings_plan"
      | "aws_reserved_instance"
      | "azure_savings_plan"
      | "azure_reservation"
      | "gcp_committed_use_discount";
    termMonths: number;
    commitmentAmountCents: string;
    expectedSavingsCents: string;
    p95DownsideLossCents: string;
    riskBand: string;
    confidenceScore: string;
  };
  optimizerRun: {
    id: string;
    frontierUri: string | null;
  };
  priceTable: {
    versionLabel: string;
  };
  forecast: {
    qualitySummary: string;
  };
}>;

export type RecommendationReportResponse = Readonly<{
  report_snapshot: ReportSnapshot;
  snapshot: Record<string, unknown>;
  rendered_html: string;
}>;
