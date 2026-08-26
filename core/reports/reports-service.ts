import { AppError } from "../shared/errors.js";
import type { ObjectStore } from "../shared/objectStore.js";
import type { RequestContext } from "../tenant/request-context.js";
import {
  parseRecommendationId,
  parseReportSourceType,
} from "../recommendations/recommendations-input.js";
import { toReportSummary } from "../recommendations/recommendations-service.js";
import type { ReportsRepository } from "./reports-repository.js";
import type {
  RecommendationReportData,
  RecommendationReportResponse,
  ReportSnapshot,
  ReportSnapshotRecord,
} from "./reports-types.js";

export interface ReportsService {
  get(
    context: RequestContext,
    sourceType: unknown,
    sourceId: unknown,
  ): Promise<RecommendationReportResponse>;
}

export function createReportsService(
  repository: ReportsRepository,
  objectStore: ObjectStore,
): ReportsService {
  return {
    get: (context, sourceType, sourceId) =>
      get(repository, objectStore, context, sourceType, sourceId),
  };
}

async function get(
  repository: ReportsRepository,
  objectStore: ObjectStore,
  context: RequestContext,
  sourceTypeValue: unknown,
  sourceIdValue: unknown,
): Promise<RecommendationReportResponse> {
  const sourceType = parseReportSourceType(sourceTypeValue);
  const sourceId = parseRecommendationId(sourceIdValue);
  const existing = await safe(() =>
    repository.getRenderedReport(context.tenantId, sourceType, sourceId),
  );
  if (existing?.renderedHtmlUri) {
    const renderedHtmlUri = existing.renderedHtmlUri;
    return {
      report_snapshot: toReportSnapshot(existing),
      snapshot: existing.snapshotJson,
      rendered_html: (await safe(() => objectStore.get(renderedHtmlUri))).toString("utf8"),
    };
  }
  const data = await safe(() => repository.recommendationReportData(context.tenantId, sourceId));
  if (!data) throw notFound();
  const snapshot = captureRecommendationSnapshot(data);
  const queued = await safe(() =>
    repository.createQueuedRecommendationReport(
      context.tenantId,
      sourceId,
      snapshot,
      context.actorUserId,
    ),
  );
  const renderedHtmlUri = `reports/recommendation/${queued.id}/recommendation_report_v1.html`;
  const rendered = renderRecommendationReport(snapshot);
  await safe(() => objectStore.put(renderedHtmlUri, Buffer.from(`${rendered}\n`, "utf8")));
  const completed = await safe(() => repository.markRendered(queued.id, renderedHtmlUri));
  return { report_snapshot: toReportSnapshot(completed), snapshot, rendered_html: rendered };
}

export function captureRecommendationSnapshot(
  data: RecommendationReportData,
): Record<string, unknown> {
  return {
    template_id: "recommendation_report:v1",
    tenant: {
      display_name: data.tenant.displayName,
      full_legal_name: data.tenant.fullLegalName,
      contact: {
        email: data.tenant.contactEmail,
        phone: data.tenant.contactPhone,
        support_url: data.tenant.supportUrl,
        finance_owner_email: data.tenant.financeOwnerEmail,
      },
    },
    recommendation: {
      id: data.recommendation.id,
      type: data.recommendation.recommendationType,
      provider: data.recommendation.provider,
      instrument: data.recommendation.instrument,
      term_months: data.recommendation.termMonths,
      commitment_amount: data.recommendation.commitmentAmountCents,
      expected_savings: data.recommendation.expectedSavingsCents,
      p95_downside_loss: data.recommendation.p95DownsideLossCents,
      risk_band: data.recommendation.riskBand,
      confidence_score: data.recommendation.confidenceScore,
    },
    frontier: {
      baseline_name: "on_demand",
      net_savings_delta: data.recommendation.expectedSavingsCents,
      uri: data.optimizerRun.frontierUri,
    },
    constraints: { binding: "risk_budget" },
    price_table: { version_label: data.priceTable.versionLabel },
    forecast: { quality_summary: data.forecast.qualitySummary },
    approval: { status: "not_required" },
  };
}

function renderRecommendationReport(snapshot: Record<string, unknown>): string {
  const tenant = objectAt(snapshot, "tenant");
  const recommendation = objectAt(snapshot, "recommendation");
  const frontier = objectAt(snapshot, "frontier");
  const constraints = objectAt(snapshot, "constraints");
  const priceTable = objectAt(snapshot, "price_table");
  const forecast = objectAt(snapshot, "forecast");
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Recommendation report</title></head><body>',
    `<h1>Recommendation report</h1>`,
    `<p>${escapeHtml(stringAt(tenant, "display_name"))} — ${escapeHtml(stringAt(tenant, "full_legal_name"))}</p>`,
    `<p>Type: ${escapeHtml(stringAt(recommendation, "type"))}</p>`,
    `<p>Provider: ${escapeHtml(stringAt(recommendation, "provider"))}</p>`,
    `<p>Instrument: ${escapeHtml(stringAt(recommendation, "instrument"))}</p>`,
    `<p>Term months: ${escapeHtml(String(recommendation.term_months))}</p>`,
    `<p>Commitment amount: ${escapeHtml(stringAt(recommendation, "commitment_amount"))}</p>`,
    `<p>Expected savings: ${escapeHtml(stringAt(recommendation, "expected_savings"))}</p>`,
    `<p>P95 downside loss: ${escapeHtml(stringAt(recommendation, "p95_downside_loss"))}</p>`,
    `<p>Risk band: ${escapeHtml(stringAt(recommendation, "risk_band"))}</p>`,
    `<p>Confidence score: ${escapeHtml(stringAt(recommendation, "confidence_score"))}</p>`,
    `<p>Baseline: ${escapeHtml(stringAt(frontier, "baseline_name"))}</p>`,
    `<p>Net savings delta: ${escapeHtml(stringAt(frontier, "net_savings_delta"))}</p>`,
    `<p>Binding constraints: ${escapeHtml(stringAt(constraints, "binding"))}</p>`,
    `<p>Price table: ${escapeHtml(stringAt(priceTable, "version_label"))}</p>`,
    `<p>Forecast quality: ${escapeHtml(stringAt(forecast, "quality_summary"))}</p>`,
    "</body></html>",
  ].join("");
}

function toReportSnapshot(row: ReportSnapshotRecord): ReportSnapshot {
  return { ...toReportSummary(row), snapshot_json: row.snapshotJson };
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "REPORTS_UNAVAILABLE",
      message: "Reports are temporarily unavailable.",
      statusCode: 503,
      details: [],
    });
  }
}

function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string") throw templateError(key);
  return value;
}

function templateError(key: string): AppError {
  return new AppError({
    code: "REPORT_TEMPLATE_TOKEN_MISSING",
    message: `Report template token is missing: ${key}.`,
    statusCode: 500,
    details: [],
  });
}

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    statusCode: 404,
    details: [],
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
