import type { Pool, QueryResultRow } from "pg";

import type {
  RecommendationListInput,
  RecommendationRecord,
  ReportSummaryRecord,
} from "./recommendations-types.js";

export interface RecommendationsRepository {
  list(tenantId: string, input: RecommendationListInput): Promise<RecommendationRecord[]>;
  get(tenantId: string, id: string): Promise<RecommendationRecord | null>;
  latestReportSummary(
    tenantId: string,
    sourceType: "recommendation",
    sourceId: string,
  ): Promise<ReportSummaryRecord | null>;
}

interface RecommendationRow extends QueryResultRow {
  id: string;
  optimizerRunId: string;
  recommendationType: RecommendationRecord["recommendationType"];
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
  riskBand: RecommendationRecord["riskBand"];
  status: RecommendationRecord["status"];
  explanation: Record<string, unknown>;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ReportSummaryRow extends QueryResultRow {
  id: string;
  sourceType: "recommendation";
  sourceId: string;
  status: ReportSummaryRecord["status"];
  renderedHtmlUri: string | null;
  renderedPdfUri: string | null;
  createdAt: string;
  updatedAt: string;
}

const RECOMMENDATION_PROJECTION = `id, optimizer_run_id AS "optimizerRunId",
  recommendation_type AS "recommendationType", provider, instrument,
  service_code AS "serviceCode", region, term_months AS "termMonths",
  commitment_amount_cents::text AS "commitmentAmountCents",
  expected_savings_cents::text AS "expectedSavingsCents",
  p95_downside_loss_cents::text AS "p95DownsideLossCents",
  to_char(utilization_p50_pct, 'FM990.00') AS "utilizationP50Pct",
  to_char(utilization_p95_pct, 'FM990.00') AS "utilizationP95Pct",
  to_char(confidence_score, 'FM0.0000') AS "confidenceScore",
  risk_band AS "riskBand", status, explanation, approval_required AS "approvalRequired",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

const REPORT_SUMMARY_PROJECTION = `id, source_type AS "sourceType", source_id AS "sourceId",
  status, rendered_html_uri AS "renderedHtmlUri", rendered_pdf_uri AS "renderedPdfUri",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createRecommendationsRepository(pool: Pool): RecommendationsRepository {
  return {
    list: (tenantId, input) => list(pool, tenantId, input),
    get: (tenantId, id) => get(pool, tenantId, id),
    latestReportSummary: (tenantId, sourceType, sourceId) =>
      latestReportSummary(pool, tenantId, sourceType, sourceId),
  };
}

async function list(
  pool: Pool,
  tenantId: string,
  input: RecommendationListInput,
): Promise<RecommendationRecord[]> {
  const result = await pool.query<RecommendationRow>(
    `SELECT ${RECOMMENDATION_PROJECTION}
       FROM recommendations
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::text IS NULL OR risk_band = $3)
        AND ($4::text IS NULL OR provider = $4)
        AND ($5::text IS NULL OR instrument = $5)
        AND ($6::uuid IS NULL OR optimizer_run_id = $6)
        AND ($7::timestamptz IS NULL OR (created_at, id) < ($7::timestamptz, $8::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $9`,
    [
      tenantId,
      input.status ?? null,
      input.riskBand ?? null,
      input.provider ?? null,
      input.instrument ?? null,
      input.optimizerRunId ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeRecommendation);
}

async function get(pool: Pool, tenantId: string, id: string): Promise<RecommendationRecord | null> {
  const result = await pool.query<RecommendationRow>(
    `SELECT ${RECOMMENDATION_PROJECTION}
       FROM recommendations
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRecommendation(result.rows[0]) : null;
}

async function latestReportSummary(
  pool: Pool,
  tenantId: string,
  sourceType: "recommendation",
  sourceId: string,
): Promise<ReportSummaryRecord | null> {
  const result = await pool.query<ReportSummaryRow>(
    `SELECT ${REPORT_SUMMARY_PROJECTION}
       FROM report_snapshots
      WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [tenantId, sourceType, sourceId],
  );
  return result.rows[0] ? freezeReportSummary(result.rows[0]) : null;
}

function freezeRecommendation(row: RecommendationRow): RecommendationRecord {
  return Object.freeze({
    id: row.id,
    optimizerRunId: row.optimizerRunId,
    recommendationType: row.recommendationType,
    provider: row.provider,
    instrument: row.instrument,
    serviceCode: row.serviceCode,
    region: row.region,
    termMonths: row.termMonths,
    commitmentAmountCents: row.commitmentAmountCents,
    expectedSavingsCents: row.expectedSavingsCents,
    p95DownsideLossCents: row.p95DownsideLossCents,
    utilizationP50Pct: row.utilizationP50Pct,
    utilizationP95Pct: row.utilizationP95Pct,
    confidenceScore: row.confidenceScore,
    riskBand: row.riskBand,
    status: row.status,
    explanation: Object.freeze({ ...row.explanation }),
    approvalRequired: row.approvalRequired,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function freezeReportSummary(row: ReportSummaryRow): ReportSummaryRecord {
  return Object.freeze({
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    status: row.status,
    renderedHtmlUri: row.renderedHtmlUri,
    renderedPdfUri: row.renderedPdfUri,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
