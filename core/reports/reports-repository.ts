import type { Pool, QueryResultRow } from "pg";

import type { RecommendationReportData, ReportSnapshotRecord } from "./reports-types.js";

export interface ReportsRepository {
  getRenderedReport(
    tenantId: string,
    sourceType: "recommendation",
    sourceId: string,
  ): Promise<ReportSnapshotRecord | null>;
  recommendationReportData(
    tenantId: string,
    recommendationId: string,
  ): Promise<RecommendationReportData | null>;
  createQueuedRecommendationReport(
    tenantId: string,
    recommendationId: string,
    snapshot: Record<string, unknown>,
    createdByUserId: string | null,
  ): Promise<ReportSnapshotRecord>;
  markRendered(id: string, renderedHtmlUri: string): Promise<ReportSnapshotRecord>;
}

interface ReportSnapshotRow extends QueryResultRow {
  id: string;
  sourceType: "recommendation";
  sourceId: string;
  snapshotJson: Record<string, unknown>;
  status: ReportSnapshotRecord["status"];
  renderedHtmlUri: string | null;
  renderedPdfUri: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RecommendationReportRow extends QueryResultRow {
  tenantDisplayName: string;
  tenantFullLegalName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  supportUrl: string | null;
  financeOwnerEmail: string | null;
  recommendationId: string;
  recommendationType: string;
  provider: "aws";
  instrument: "aws_compute_savings_plan";
  termMonths: number;
  commitmentAmountCents: string;
  expectedSavingsCents: string;
  p95DownsideLossCents: string;
  riskBand: string;
  confidenceScore: string;
  optimizerRunId: string;
  frontierUri: string | null;
  priceVersionLabel: string | null;
  forecastQuality: Record<string, unknown>;
}

const SNAPSHOT_PROJECTION = `id, source_type AS "sourceType", source_id AS "sourceId",
  snapshot_json AS "snapshotJson", status,
  rendered_html_uri AS "renderedHtmlUri", rendered_pdf_uri AS "renderedPdfUri",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createReportsRepository(pool: Pool): ReportsRepository {
  return {
    getRenderedReport: (tenantId, sourceType, sourceId) =>
      getRenderedReport(pool, tenantId, sourceType, sourceId),
    recommendationReportData: (tenantId, recommendationId) =>
      recommendationReportData(pool, tenantId, recommendationId),
    createQueuedRecommendationReport: (tenantId, recommendationId, snapshot, createdByUserId) =>
      createQueuedRecommendationReport(pool, tenantId, recommendationId, snapshot, createdByUserId),
    markRendered: (id, renderedHtmlUri) => markRendered(pool, id, renderedHtmlUri),
  };
}

async function getRenderedReport(
  pool: Pool,
  tenantId: string,
  sourceType: "recommendation",
  sourceId: string,
): Promise<ReportSnapshotRecord | null> {
  const result = await pool.query<ReportSnapshotRow>(
    `SELECT ${SNAPSHOT_PROJECTION}
       FROM report_snapshots
      WHERE tenant_id = $1
        AND source_type = $2
        AND source_id = $3
        AND status = 'rendered'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [tenantId, sourceType, sourceId],
  );
  return result.rows[0] ? freezeSnapshot(result.rows[0]) : null;
}

async function recommendationReportData(
  pool: Pool,
  tenantId: string,
  recommendationId: string,
): Promise<RecommendationReportData | null> {
  const result = await pool.query<RecommendationReportRow>(
    `SELECT t.display_name AS "tenantDisplayName",
            t.full_legal_name AS "tenantFullLegalName",
            t.contact_email AS "contactEmail",
            t.contact_phone AS "contactPhone",
            t.support_url AS "supportUrl",
            t.finance_owner_email AS "financeOwnerEmail",
            rec.id AS "recommendationId",
            rec.recommendation_type AS "recommendationType",
            rec.provider,
            rec.instrument,
            rec.term_months AS "termMonths",
            rec.commitment_amount_cents::text AS "commitmentAmountCents",
            rec.expected_savings_cents::text AS "expectedSavingsCents",
            rec.p95_downside_loss_cents::text AS "p95DownsideLossCents",
            rec.risk_band AS "riskBand",
            to_char(rec.confidence_score, 'FM0.0000') AS "confidenceScore",
            run.id AS "optimizerRunId",
            run.frontier_uri AS "frontierUri",
            price.version_label AS "priceVersionLabel",
            forecast.quality_metrics AS "forecastQuality"
       FROM recommendations rec
       JOIN tenants t ON t.id = rec.tenant_id
       JOIN optimizer_runs run ON run.tenant_id = rec.tenant_id AND run.id = rec.optimizer_run_id
       JOIN forecast_runs forecast ON forecast.tenant_id = run.tenant_id AND forecast.id = run.forecast_run_id
       LEFT JOIN LATERAL (
         SELECT version_label
           FROM price_table_versions
          WHERE tenant_id = run.tenant_id AND id = ANY(run.price_table_version_ids)
          ORDER BY effective_from DESC, id DESC
          LIMIT 1
       ) price ON true
      WHERE rec.tenant_id = $1 AND rec.id = $2`,
    [tenantId, recommendationId],
  );
  const row = result.rows[0];
  return row
    ? Object.freeze({
        tenant: Object.freeze({
          displayName: row.tenantDisplayName,
          fullLegalName: row.tenantFullLegalName,
          contactEmail: row.contactEmail,
          contactPhone: row.contactPhone,
          supportUrl: row.supportUrl,
          financeOwnerEmail: row.financeOwnerEmail,
        }),
        recommendation: Object.freeze({
          id: row.recommendationId,
          recommendationType: row.recommendationType,
          provider: row.provider,
          instrument: row.instrument,
          termMonths: row.termMonths,
          commitmentAmountCents: row.commitmentAmountCents,
          expectedSavingsCents: row.expectedSavingsCents,
          p95DownsideLossCents: row.p95DownsideLossCents,
          riskBand: row.riskBand,
          confidenceScore: row.confidenceScore,
        }),
        optimizerRun: Object.freeze({ id: row.optimizerRunId, frontierUri: row.frontierUri }),
        priceTable: Object.freeze({ versionLabel: row.priceVersionLabel ?? "unknown" }),
        forecast: Object.freeze({ qualitySummary: qualitySummary(row.forecastQuality) }),
      })
    : null;
}

async function createQueuedRecommendationReport(
  pool: Pool,
  tenantId: string,
  recommendationId: string,
  snapshot: Record<string, unknown>,
  createdByUserId: string | null,
): Promise<ReportSnapshotRecord> {
  const result = await pool.query<ReportSnapshotRow>(
    `INSERT INTO report_snapshots
       (tenant_id, source_type, source_id, snapshot_json, created_by_user_id)
     VALUES ($1, 'recommendation', $2, $3::jsonb, $4)
     RETURNING ${SNAPSHOT_PROJECTION}`,
    [tenantId, recommendationId, JSON.stringify(snapshot), createdByUserId],
  );
  return freezeSnapshot(result.rows[0]!);
}

async function markRendered(
  pool: Pool,
  id: string,
  renderedHtmlUri: string,
): Promise<ReportSnapshotRecord> {
  const result = await pool.query<ReportSnapshotRow>(
    `UPDATE report_snapshots
        SET status = 'rendered', rendered_html_uri = $2
      WHERE id = $1 AND status = 'queued'
      RETURNING ${SNAPSHOT_PROJECTION}`,
    [id, renderedHtmlUri],
  );
  return freezeSnapshot(result.rows[0]!);
}

function qualitySummary(value: Record<string, unknown>): string {
  const confidence = typeof value.confidence === "string" ? value.confidence : "unknown";
  return `confidence:${confidence}`;
}

function freezeSnapshot(row: ReportSnapshotRow): ReportSnapshotRecord {
  return Object.freeze({
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    snapshotJson: Object.freeze({ ...row.snapshotJson }),
    status: row.status,
    renderedHtmlUri: row.renderedHtmlUri,
    renderedPdfUri: row.renderedPdfUri,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
