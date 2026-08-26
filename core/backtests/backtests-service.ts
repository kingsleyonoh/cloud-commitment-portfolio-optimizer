import { randomUUID } from "node:crypto";

import { AppError } from "../shared/errors.js";
import type { ObjectStore } from "../shared/objectStore.js";
import type { RequestContext } from "../tenant/request-context.js";
import {
  parseBacktestCreateBody,
  parseBacktestId,
  parseBacktestListQuery,
} from "./backtests-input.js";
import type { BacktestsRepository } from "./backtests-repository.js";
import type {
  BacktestDetail,
  BacktestListPage,
  BacktestRun,
  BacktestRunRecord,
} from "./backtests-types.js";

export interface BacktestsService {
  create(context: RequestContext, body: unknown): Promise<BacktestRun>;
  list(context: RequestContext, query: unknown): Promise<BacktestListPage>;
  get(context: RequestContext, id: unknown): Promise<BacktestDetail>;
}

export interface BacktestsServiceOptions {
  maxMonths: number;
  defaultSeed: bigint;
}

export function createBacktestsService(
  repository: BacktestsRepository,
  objectStore: ObjectStore,
  options: BacktestsServiceOptions,
): BacktestsService {
  return {
    create: (context, body) => createRun(repository, objectStore, options, context, body),
    list: (context, query) => listRuns(repository, context, query),
    get: (context, id) => getRun(repository, context, id),
  };
}

async function createRun(
  repository: BacktestsRepository,
  objectStore: ObjectStore,
  options: BacktestsServiceOptions,
  context: RequestContext,
  body: unknown,
): Promise<BacktestRun> {
  const input = parseBacktestCreateBody(body, options.maxMonths);
  const policy = await safe(() => repository.policySnapshot(context.tenantId, input.policyId));
  if (!policy) throw notFound();
  if (policy.status !== "active") throw inputInvalid();
  const id = randomUUID();
  const inputSnapshotUri = `backtests/${id}/input.json`;
  await writeSnapshot(objectStore, inputSnapshotUri, {
    contract_version: "backtest-run-input-snapshot/v1",
    run_id: id,
    policy,
    baseline: input.baseline,
    window: {
      start: input.windowStart,
      end: input.windowEnd,
      max_months: options.maxMonths,
    },
    random_seed: options.defaultSeed.toString(),
  });
  const row = await safe(() =>
    repository.create(context.tenantId, {
      ...input,
      id,
      inputSnapshotUri,
      createdByUserId: context.actorUserId,
    }),
  );
  return toRun(row);
}

async function listRuns(
  repository: BacktestsRepository,
  context: RequestContext,
  query: unknown,
): Promise<BacktestListPage> {
  const input = parseBacktestListQuery(query);
  const rows = await safe(() => repository.list(context.tenantId, input));
  return { backtests: rows.map(toRun) };
}

async function getRun(
  repository: BacktestsRepository,
  context: RequestContext,
  idValue: unknown,
): Promise<BacktestDetail> {
  const id = parseBacktestId(idValue);
  const row = await safe(() => repository.get(context.tenantId, id));
  if (!row) throw notFound();
  return { backtest: toRun(row) };
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

function toRun(row: BacktestRunRecord): BacktestRun {
  return {
    id: row.id,
    name: row.name,
    policy_id: row.policyId,
    baseline: row.baseline,
    window_start: row.windowStart,
    window_end: row.windowEnd,
    status: row.status,
    input_snapshot_uri: row.inputSnapshotUri,
    output_uri: row.outputUri,
    metrics: row.metrics,
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

function inputInvalid(): AppError {
  return new AppError({
    code: "BACKTEST_INPUT_INVALID",
    message: "Backtest inputs are not eligible.",
    statusCode: 409,
    details: [],
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "BACKTESTS_UNAVAILABLE",
    message: "Backtests are temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
