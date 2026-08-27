import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import {
  decodeOptimizerPolicyCursor,
  encodeOptimizerPolicyCursor,
} from "./optimizer-policies-cursor.js";
import {
  parseOptimizerPolicyCreateBody,
  parseOptimizerPolicyId,
  parseOptimizerPolicyListQuery,
  parseOptimizerPolicyPatchBody,
} from "./optimizer-policies-input.js";
import type { OptimizerPoliciesRepository } from "./optimizer-policies-repository.js";
import type {
  OptimizerPolicy,
  OptimizerPolicyListPage,
  OptimizerPolicyRecord,
} from "./optimizer-policies-types.js";

export interface OptimizerPoliciesService {
  create(context: RequestContext, body: unknown): Promise<OptimizerPolicy>;
  list(context: RequestContext, query: unknown): Promise<OptimizerPolicyListPage>;
  patch(context: RequestContext, id: unknown, body: unknown): Promise<OptimizerPolicy>;
}

export function createOptimizerPoliciesService(
  repository: OptimizerPoliciesRepository,
): OptimizerPoliciesService {
  return {
    create: (context, body) => createPolicy(repository, context, body),
    list: (context, query) => listPolicies(repository, context, query),
    patch: (context, id, body) => patchPolicy(repository, context, id, body),
  };
}

async function createPolicy(
  repository: OptimizerPoliciesRepository,
  context: RequestContext,
  body: unknown,
): Promise<OptimizerPolicy> {
  const input = parseOptimizerPolicyCreateBody(body);
  const row = await safe(() => repository.create(context.tenantId, input));
  return toPolicy(row);
}

async function listPolicies(
  repository: OptimizerPoliciesRepository,
  context: RequestContext,
  query: unknown,
): Promise<OptimizerPolicyListPage> {
  const parsed = parseOptimizerPolicyListQuery(query);
  const cursor =
    query && typeof query === "object" && typeof (query as { cursor?: unknown }).cursor === "string"
      ? decodeOptimizerPolicyCursor((query as { cursor: string }).cursor)
      : undefined;
  const rows = await safe(() =>
    repository.list(context.tenantId, {
      ...parsed,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );
  const selected = rows.slice(0, parsed.limit);
  const last = selected.at(-1);
  return {
    optimizer_policies: selected.map(toPolicy),
    next_cursor: rows.length > parsed.limit && last ? encodeOptimizerPolicyCursor(last) : null,
  };
}

async function patchPolicy(
  repository: OptimizerPoliciesRepository,
  context: RequestContext,
  idValue: unknown,
  body: unknown,
): Promise<OptimizerPolicy> {
  const id = parseOptimizerPolicyId(idValue);
  const input = parseOptimizerPolicyPatchBody(body);
  const row = await safe(() => repository.patch(context.tenantId, id, input));
  if (!row) throw notFound();
  return toPolicy(row);
}

function toPolicy(row: OptimizerPolicyRecord): OptimizerPolicy {
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    max_downside_loss_cents: row.maxDownsideLossCents,
    min_expected_savings_cents: row.minExpectedSavingsCents,
    max_utilization_gap_pct: row.maxUtilizationGapPct,
    approval_threshold_cents: row.approvalThresholdCents,
    allowed_instruments: row.allowedInstruments,
    config: row.config,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const constraint =
      error && typeof error === "object"
        ? (error as { constraint?: unknown }).constraint
        : undefined;
    const code =
      error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    if (constraint === "optimizer_policies_name_key") throw conflict();
    if (code === "55000") throw frozen();
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

function conflict(): AppError {
  return new AppError({
    code: "OPTIMIZER_POLICY_CONFLICT",
    message: "Optimizer policy already exists.",
    statusCode: 409,
    details: [],
  });
}

function frozen(): AppError {
  return new AppError({
    code: "OPTIMIZER_POLICY_FROZEN",
    message: "Optimizer policy cannot be changed in its current status.",
    statusCode: 409,
    details: [],
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "OPTIMIZER_POLICIES_UNAVAILABLE",
    message: "Optimizer policies are temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
