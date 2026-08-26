import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import type { DashboardRepository } from "./dashboard-repository.js";
import type { DashboardSummary } from "./dashboard-types.js";

export interface DashboardService {
  summary(context: RequestContext): Promise<DashboardSummary>;
}

export function createDashboardService(repository: DashboardRepository): DashboardService {
  return {
    summary: (context) => summary(repository, context),
  };
}

async function summary(
  repository: DashboardRepository,
  context: RequestContext,
): Promise<DashboardSummary> {
  try {
    const tenant = await repository.getTenant(context.tenantId);
    if (!tenant) throw notFound();
    const [importStatuses, recommendationStatuses, recentRecommendations] = await Promise.all([
      repository.listImportStatuses(context.tenantId),
      repository.listRecommendationStatuses(context.tenantId),
      repository.listRecentRecommendations(context.tenantId),
    ]);
    return {
      tenant,
      role: context.role,
      importStatuses,
      recommendationStatuses,
      recentRecommendations,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "DASHBOARD_UNAVAILABLE",
      message: "The dashboard is temporarily unavailable.",
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
