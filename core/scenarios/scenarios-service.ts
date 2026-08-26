import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import { encodeScenarioCursor } from "./scenarios-cursor.js";
import {
  parseScenarioCreateBody,
  parseScenarioId,
  parseScenarioListQuery,
} from "./scenarios-input.js";
import type { ScenariosRepository } from "./scenarios-repository.js";
import type { Scenario, ScenarioListInput, ScenarioRecord } from "./scenarios-types.js";

export interface ScenariosService {
  list(
    context: RequestContext,
    query: unknown,
  ): Promise<{ scenarios: readonly Scenario[]; next_cursor: string | null }>;
  get(context: RequestContext, id: unknown): Promise<Scenario>;
  create(context: RequestContext, body: unknown): Promise<Scenario>;
}

export function createScenariosService(repository: ScenariosRepository): ScenariosService {
  return {
    list: (context, query) => list(repository, context, query),
    get: (context, id) => get(repository, context, id),
    create: (context, body) => create(repository, context, body),
  };
}

async function list(repository: ScenariosRepository, context: RequestContext, query: unknown) {
  const input = parseScenarioListQuery(query) as ScenarioListInput;
  const rows = await safe(() => repository.list(context.tenantId, input));
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    scenarios: page.map(toScenario),
    next_cursor:
      rows.length > input.limit && last
        ? encodeScenarioCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

async function get(
  repository: ScenariosRepository,
  context: RequestContext,
  idValue: unknown,
): Promise<Scenario> {
  const id = parseScenarioId(idValue);
  const row = await safe(() => repository.get(context.tenantId, id));
  if (!row) throw notFound();
  return toScenario(row);
}

async function create(
  repository: ScenariosRepository,
  context: RequestContext,
  body: unknown,
): Promise<Scenario> {
  if (context.actorType !== "user" || !["tenant_admin", "finops_analyst"].includes(context.role)) {
    throw new AppError({ code: "FORBIDDEN", message: "Access denied.", statusCode: 403 });
  }
  const input = parseScenarioCreateBody(body);
  return toScenario(
    await safe(() => repository.create(context.tenantId, context.actorUserId, input)),
  );
}

function toScenario(row: ScenarioRecord): Scenario {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    base_forecast_run_id: row.baseForecastRunId,
    shock_config: row.shockConfig,
    status: row.status,
    created_by_user_id: row.createdByUserId,
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
      code: "SCENARIOS_UNAVAILABLE",
      message: "Scenarios are temporarily unavailable.",
      statusCode: 503,
    });
  }
}

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    statusCode: 404,
  });
}
