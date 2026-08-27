import { AppError } from "../shared/errors.js";
import type { ObjectStore } from "../shared/objectStore.js";
import type { RequestContext } from "../tenant/request-context.js";
import {
  parseRecommendationId,
  parseReportSourceType,
} from "../recommendations/recommendations-input.js";
import { toReportSummary } from "../recommendations/recommendations-service.js";
import type { ReportsRepository } from "./reports-repository.js";
import {
  assertRecommendationReportTemplateInventory,
  RECOMMENDATION_REPORT_TEMPLATE_ID,
  renderStrictTemplate,
  resolveReportTemplate,
} from "./report-templates.js";
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

export interface ReportsServiceOptions {
  resolveTemplate?: (templateId: string, tenantId: string) => Promise<string>;
}

export function createReportsService(
  repository: ReportsRepository,
  objectStore: ObjectStore,
  options: ReportsServiceOptions = {},
): ReportsService {
  const templateResolver = options.resolveTemplate ?? resolveReportTemplate;
  return {
    get: (context, sourceType, sourceId) =>
      get(repository, objectStore, templateResolver, context, sourceType, sourceId),
  };
}

async function get(
  repository: ReportsRepository,
  objectStore: ObjectStore,
  templateResolver: (templateId: string, tenantId: string) => Promise<string>,
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
  try {
    const renderedHtmlUri = `reports/recommendation/${queued.id}/recommendation_report_v1.html`;
    const template = await templateResolver(RECOMMENDATION_REPORT_TEMPLATE_ID, context.tenantId);
    assertRecommendationReportTemplateInventory(template);
    const rendered = renderStrictTemplate(template, snapshot);
    const renderedHtml = `${rendered}\n`;
    await safe(() => objectStore.put(renderedHtmlUri, Buffer.from(renderedHtml, "utf8")));
    const completed = await safe(() => repository.markRendered(queued.id, renderedHtmlUri));
    return { report_snapshot: toReportSnapshot(completed), snapshot, rendered_html: renderedHtml };
  } catch (error) {
    await safe(() => repository.markFailed(queued.id));
    throw error;
  }
}

export function captureRecommendationSnapshot(
  data: RecommendationReportData,
): Record<string, unknown> {
  return {
    template_id: RECOMMENDATION_REPORT_TEMPLATE_ID,
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

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    statusCode: 404,
    details: [],
  });
}
