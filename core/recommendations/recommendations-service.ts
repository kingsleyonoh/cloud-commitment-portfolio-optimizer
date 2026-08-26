import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import {
  encodeRecommendationCursor,
  parseRecommendationId,
  parseRecommendationListQuery,
} from "./recommendations-input.js";
import type { RecommendationsRepository } from "./recommendations-repository.js";
import type {
  Recommendation,
  RecommendationDetail,
  RecommendationListPage,
  RecommendationRecord,
  ReportSummary,
  ReportSummaryRecord,
} from "./recommendations-types.js";

export interface RecommendationsService {
  list(context: RequestContext, query: unknown): Promise<RecommendationListPage>;
  get(context: RequestContext, id: unknown): Promise<RecommendationDetail>;
}

export function createRecommendationsService(
  repository: RecommendationsRepository,
): RecommendationsService {
  return {
    list: (context, query) => list(repository, context, query),
    get: (context, id) => get(repository, context, id),
  };
}

async function list(
  repository: RecommendationsRepository,
  context: RequestContext,
  query: unknown,
): Promise<RecommendationListPage> {
  const input = parseRecommendationListQuery(query);
  const rows = await safe(() => repository.list(context.tenantId, input));
  const page = rows.slice(0, input.limit);
  const boundary = rows.length > input.limit ? page.at(-1) : undefined;
  return {
    recommendations: page.map(toRecommendation),
    next_cursor: boundary ? encodeRecommendationCursor(boundary.createdAt, boundary.id) : null,
  };
}

async function get(
  repository: RecommendationsRepository,
  context: RequestContext,
  idValue: unknown,
): Promise<RecommendationDetail> {
  const id = parseRecommendationId(idValue);
  const row = await safe(() => repository.get(context.tenantId, id));
  if (!row) throw notFound();
  const report = await safe(() =>
    repository.latestReportSummary(context.tenantId, "recommendation", id),
  );
  return {
    recommendation: toRecommendation(row),
    report_summary: report ? toReportSummary(report) : null,
  };
}

export function toRecommendation(row: RecommendationRecord): Recommendation {
  return {
    id: row.id,
    optimizer_run_id: row.optimizerRunId,
    recommendation_type: row.recommendationType,
    provider: row.provider,
    instrument: row.instrument,
    service_code: row.serviceCode,
    region: row.region,
    term_months: row.termMonths,
    commitment_amount_cents: row.commitmentAmountCents,
    expected_savings_cents: row.expectedSavingsCents,
    p95_downside_loss_cents: row.p95DownsideLossCents,
    utilization_p50_pct: row.utilizationP50Pct,
    utilization_p95_pct: row.utilizationP95Pct,
    confidence_score: row.confidenceScore,
    risk_band: row.riskBand,
    status: row.status,
    explanation: row.explanation,
    approval_required: row.approvalRequired,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function toReportSummary(row: ReportSummaryRecord): ReportSummary {
  return {
    id: row.id,
    source_type: row.sourceType,
    source_id: row.sourceId,
    status: row.status,
    rendered_html_uri: row.renderedHtmlUri,
    rendered_pdf_uri: row.renderedPdfUri,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "RECOMMENDATIONS_UNAVAILABLE",
      message: "Recommendations are temporarily unavailable.",
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
