import { randomUUID } from "node:crypto";

import { AppError } from "../shared/errors.js";
import type { ObjectStore } from "../shared/objectStore.js";
import type { RequestContext } from "../tenant/request-context.js";
import { parseOptimizerRunCreateBody, parseOptimizerRunId } from "./optimizer-runs-input.js";
import type { OptimizerRunsRepository } from "./optimizer-runs-repository.js";
import type {
  OptimizerRun,
  OptimizerRunDetail,
  OptimizerRunListPage,
  OptimizerRunRecord,
  OptimizerRunStatus,
} from "./optimizer-runs-types.js";

export interface OptimizerRunsService {
  create(context: RequestContext, body: unknown): Promise<OptimizerRun>;
  list(context: RequestContext, query: unknown): Promise<OptimizerRunListPage>;
  get(context: RequestContext, id: unknown): Promise<OptimizerRunDetail>;
}

export interface OptimizerRunsServiceOptions {
  defaultSeed: bigint;
}

export function createOptimizerRunsService(
  repository: OptimizerRunsRepository,
  objectStore: ObjectStore,
  options: OptimizerRunsServiceOptions,
): OptimizerRunsService {
  return {
    create: (context, body) =>
      createRun(repository, objectStore, options.defaultSeed, context, body),
    list: (context, query) => listRuns(repository, context, query),
    get: (context, id) => getRun(repository, objectStore, context, id),
  };
}

async function createRun(
  repository: OptimizerRunsRepository,
  objectStore: ObjectStore,
  defaultSeed: bigint,
  context: RequestContext,
  body: unknown,
): Promise<OptimizerRun> {
  const input = parseOptimizerRunCreateBody(body);
  const resolved = await safe(() => repository.resolveInputs(context.tenantId, input));
  if (!resolved) throw notFound();
  const id = randomUUID();
  const priceTableVersionIds =
    input.priceTableVersionIds ?? resolved.priceTableVersions.map((row) => row.id);
  const inputSnapshotUri = `optimizer-runs/${id}/input.json`;
  const randomSeed = defaultSeed.toString();
  await writeSnapshot(objectStore, inputSnapshotUri, {
    contract_version: "optimizer-run-input-snapshot/v1",
    run_id: id,
    forecast_run: resolved.forecastRun,
    policy: resolved.policy,
    scenario: resolved.scenario,
    provider: input.provider,
    instrument: input.instrument,
    price_table_versions: resolved.priceTableVersions,
    random_seed: randomSeed,
  });
  const row = await safe(() =>
    repository.create(context.tenantId, {
      ...input,
      id,
      priceTableVersionIds,
      randomSeed,
      inputSnapshotUri,
      createdByUserId: context.actorUserId,
    }),
  );
  return toRun(row);
}

async function listRuns(
  repository: OptimizerRunsRepository,
  context: RequestContext,
  query: unknown,
): Promise<OptimizerRunListPage> {
  const input = parseListQuery(query);
  const rows = await safe(() => repository.list(context.tenantId, input));
  return { optimizer_runs: rows.map(toRun) };
}

async function getRun(
  repository: OptimizerRunsRepository,
  objectStore: ObjectStore,
  context: RequestContext,
  idValue: unknown,
): Promise<OptimizerRunDetail> {
  const id = parseOptimizerRunId(idValue);
  const row = await safe(() => repository.get(context.tenantId, id));
  if (!row) throw notFound();
  return {
    optimizer_run: toRun(row),
    frontier_summary: row.frontierUri
      ? await readFrontierSummary(objectStore, row.frontierUri)
      : null,
  };
}

const RUN_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "infeasible",
  "cancelled",
]);

function parseListQuery(query: unknown): { limit: number; status?: OptimizerRunStatus } {
  if (!query || typeof query !== "object" || Array.isArray(query)) return { limit: 50 };
  const input = query as Record<string, unknown>;
  const allowed = new Set(["limit", "status"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw validationError();
  const limitValue = input.limit;
  const limit =
    limitValue === undefined
      ? 50
      : typeof limitValue === "string" && /^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)
        ? Number(limitValue)
        : null;
  if (limit === null) throw validationError();
  const status = input.status;
  if (status !== undefined && (typeof status !== "string" || !RUN_STATUSES.has(status))) {
    throw validationError();
  }
  return status === undefined ? { limit } : { limit, status: status as OptimizerRunStatus };
}

async function readFrontierSummary(
  objectStore: ObjectStore,
  frontierUri: string,
): Promise<Record<string, unknown> | null> {
  const parsed = await safe(async () =>
    JSON.parse((await objectStore.get(frontierUri)).toString("utf8")),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const summary = (parsed as Record<string, unknown>).summary;
  return summary && typeof summary === "object" && !Array.isArray(summary)
    ? (summary as Record<string, unknown>)
    : null;
}

async function writeSnapshot(
  objectStore: ObjectStore,
  key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await objectStore.put(key, Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable();
  }
}

function toRun(row: OptimizerRunRecord): OptimizerRun {
  return {
    id: row.id,
    forecast_run_id: row.forecastRunId,
    scenario_id: row.scenarioId,
    optimizer_policy_id: row.optimizerPolicyId,
    provider: row.provider,
    instrument: row.instrument,
    price_table_version_ids: row.priceTableVersionIds,
    status: row.status,
    random_seed: row.randomSeed,
    input_snapshot_uri: row.inputSnapshotUri,
    output_uri: row.outputUri,
    frontier_uri: row.frontierUri,
    infeasibility_details: row.infeasibilityDetails,
    error_details: row.errorDetails,
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
    code: "OPTIMIZER_RUNS_UNAVAILABLE",
    message: "Optimizer runs are temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}

function validationError(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
