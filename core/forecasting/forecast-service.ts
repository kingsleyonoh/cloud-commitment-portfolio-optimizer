import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import { decodeForecastCursor, encodeForecastCursor } from "./forecast-cursor.js";
import {
  parseForecastId,
  parseForecastModelCreateBody,
  parseForecastModelListQuery,
  parseForecastRunCreateBody,
  parseForecastRunListQuery,
} from "./forecast-input.js";
import type { ForecastRepository } from "./forecast-repository.js";
import type {
  ForecastModel,
  ForecastModelListPage,
  ForecastModelRecord,
  ForecastRun,
  ForecastRunListPage,
  ForecastRunRecord,
} from "./forecast-types.js";

export interface ForecastService {
  createModel(context: RequestContext, body: unknown): Promise<ForecastModel>;
  listModels(context: RequestContext, query: unknown): Promise<ForecastModelListPage>;
  createRun(context: RequestContext, body: unknown): Promise<ForecastRun>;
  listRuns(context: RequestContext, query: unknown): Promise<ForecastRunListPage>;
  getRun(context: RequestContext, id: unknown): Promise<ForecastRun>;
}

export interface ForecastServiceOptions {
  defaultSeed: bigint;
}

export function createForecastService(
  repository: ForecastRepository,
  options: ForecastServiceOptions,
): ForecastService {
  return {
    createModel: (context, body) => createModel(repository, context, body),
    listModels: (context, query) => listModels(repository, context, query),
    createRun: (context, body) => createRun(repository, options.defaultSeed, context, body),
    listRuns: (context, query) => listRuns(repository, context, query),
    getRun: (context, id) => getRun(repository, context, id),
  };
}

async function createModel(
  repository: ForecastRepository,
  context: RequestContext,
  body: unknown,
): Promise<ForecastModel> {
  const input = parseForecastModelCreateBody(body);
  const row = await safe(() =>
    repository.createModel(context.tenantId, context.actorUserId, input),
  );
  return toModel(row);
}

async function listModels(
  repository: ForecastRepository,
  context: RequestContext,
  query: unknown,
): Promise<ForecastModelListPage> {
  const parsed = parseForecastModelListQuery(query);
  const cursor = cursorFrom(query);
  const rows = await safe(() =>
    repository.listModels(context.tenantId, {
      ...parsed,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );
  const selected = rows.slice(0, parsed.limit);
  const last = selected.at(-1);
  return {
    forecast_models: selected.map(toModel),
    next_cursor: rows.length > parsed.limit && last ? encodeForecastCursor(last) : null,
  };
}

async function createRun(
  repository: ForecastRepository,
  defaultSeed: bigint,
  context: RequestContext,
  body: unknown,
): Promise<ForecastRun> {
  const input = parseForecastRunCreateBody(body, defaultSeed);
  const row = await safe(() => repository.createRun(context.tenantId, input));
  if (!row) throw notFound();
  return toRun(row);
}

async function listRuns(
  repository: ForecastRepository,
  context: RequestContext,
  query: unknown,
): Promise<ForecastRunListPage> {
  const parsed = parseForecastRunListQuery(query);
  const cursor = cursorFrom(query);
  const rows = await safe(() =>
    repository.listRuns(context.tenantId, {
      ...parsed,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );
  const selected = rows.slice(0, parsed.limit);
  const last = selected.at(-1);
  return {
    forecast_runs: selected.map(toRun),
    next_cursor: rows.length > parsed.limit && last ? encodeForecastCursor(last) : null,
  };
}

async function getRun(
  repository: ForecastRepository,
  context: RequestContext,
  idValue: unknown,
): Promise<ForecastRun> {
  const id = parseForecastId(idValue);
  const row = await safe(() => repository.getRun(context.tenantId, id));
  if (!row) throw notFound();
  return toRun(row);
}

function cursorFrom(query: unknown) {
  return query &&
    typeof query === "object" &&
    typeof (query as { cursor?: unknown }).cursor === "string"
    ? decodeForecastCursor((query as { cursor: string }).cursor)
    : undefined;
}

function toModel(row: ForecastModelRecord): ForecastModel {
  return {
    id: row.id,
    name: row.name,
    provider_scope: row.providerScope,
    service_scope: row.serviceScope,
    horizon_months: row.horizonMonths,
    method: row.method,
    config: row.config,
    status: row.status,
    created_by_user_id: row.createdByUserId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toRun(row: ForecastRunRecord): ForecastRun {
  return {
    id: row.id,
    forecast_model_id: row.forecastModelId,
    status: row.status,
    input_window_start: row.inputWindowStart,
    input_window_end: row.inputWindowEnd,
    horizon_months: row.horizonMonths,
    random_seed: row.randomSeed,
    output_uri: row.outputUri,
    quality_metrics: row.qualityMetrics,
    error_details: row.errorDetails,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable();
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

function unavailable(): AppError {
  return new AppError({
    code: "FORECASTS_UNAVAILABLE",
    message: "Forecasts are temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
