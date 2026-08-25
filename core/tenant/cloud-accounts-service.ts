import { AppError } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { decodeCloudAccountCursor, encodeCloudAccountCursor } from "./cloud-accounts-cursor.js";
import {
  normalizeCloudAccountCreate,
  normalizeCloudAccountPatch,
  normalizeDeactivationReason,
  parseCloudAccountId,
  parseCloudAccountListQuery,
} from "./cloud-accounts-input.js";
import type { CloudAccountsRepository } from "./cloud-accounts-repository.js";
import type {
  CloudAccount,
  CloudAccountListPage,
  CloudAccountRecord,
} from "./cloud-accounts-types.js";
import type { RequestContext } from "./request-context.js";

export interface CloudAccountsService {
  list(context: RequestContext, query: unknown): Promise<CloudAccountListPage>;
  create(context: RequestContext, body: unknown): Promise<CloudAccount>;
  patch(context: RequestContext, accountId: unknown, body: unknown): Promise<CloudAccount>;
  deactivate(context: RequestContext, accountId: unknown, body: unknown): Promise<CloudAccount>;
}

export function createCloudAccountsService(
  repository: CloudAccountsRepository,
  logger: Logger,
): CloudAccountsService {
  return {
    list: (context, query) => listAccounts(repository, context, query),
    create: (context, body) => createAccount(repository, logger, context, body),
    patch: (context, accountId, body) => patchAccount(repository, logger, context, accountId, body),
    deactivate: (context, accountId, body) =>
      deactivateAccount(repository, logger, context, accountId, body),
  };
}

async function listAccounts(
  repository: CloudAccountsRepository,
  context: RequestContext,
  query: unknown,
): Promise<CloudAccountListPage> {
  const parsed = parseCloudAccountListQuery(query);
  const cursor =
    query && typeof query === "object" && typeof (query as { cursor?: unknown }).cursor === "string"
      ? decodeCloudAccountCursor((query as { cursor: string }).cursor)
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
    cloud_accounts: selected.map(toCloudAccount),
    next_cursor: rows.length > parsed.limit && last ? encodeCloudAccountCursor(last) : null,
  };
}

async function createAccount(
  repository: CloudAccountsRepository,
  logger: Logger,
  context: RequestContext,
  body: unknown,
): Promise<CloudAccount> {
  const input = normalizeCloudAccountCreate(body);
  const row = await safeCreate(() => repository.create(context.tenantId, input));
  await logMutation(logger, context, row, "cloud_accounts.create");
  return toCloudAccount(row);
}

async function patchAccount(
  repository: CloudAccountsRepository,
  logger: Logger,
  context: RequestContext,
  accountId: unknown,
  body: unknown,
): Promise<CloudAccount> {
  const id = parseCloudAccountId(accountId);
  const input = normalizeCloudAccountPatch(body);
  const result = await safeCreate(() =>
    repository.patch({
      tenantId: context.tenantId,
      accountId: id,
      expectedUpdatedAt: input.expectedUpdatedAt,
      changes: input.changes,
    }),
  );
  if (result.kind === "not_found") throw notFound();
  if (result.kind === "version_conflict") throw conflict("CLOUD_ACCOUNT_VERSION_CONFLICT");
  await logMutation(logger, context, result.account, "cloud_accounts.patch");
  return toCloudAccount(result.account);
}

async function deactivateAccount(
  repository: CloudAccountsRepository,
  logger: Logger,
  context: RequestContext,
  accountId: unknown,
  body: unknown,
): Promise<CloudAccount> {
  normalizeDeactivationReason(body);
  const id = parseCloudAccountId(accountId);
  const result = await safe(() =>
    repository.deactivate({ tenantId: context.tenantId, accountId: id }),
  );
  if (result.kind === "not_found") throw notFound();
  await logMutation(logger, context, result.account, "cloud_accounts.deactivate");
  return toCloudAccount(result.account);
}

function toCloudAccount(row: CloudAccountRecord): CloudAccount {
  return {
    id: row.id,
    provider: row.provider,
    external_ref: row.externalRef,
    display_name: row.displayName,
    currency: row.currency,
    tags: row.tags,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function logMutation(
  logger: Logger,
  context: RequestContext,
  row: CloudAccountRecord,
  event: string,
): Promise<void> {
  await logger.info(event, {
    requestId: context.requestId,
    tenantId: context.tenantId,
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    apiKeyId: context.apiKeyId,
    cloudAccountId: row.id,
  });
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw unavailable();
  }
}

async function safeCreate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isConflict(error)) throw conflict("CLOUD_ACCOUNT_CONFLICT");
    throw unavailable();
  }
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === "23505" &&
    candidate.constraint === "cloud_accounts_tenant_provider_external_ref_key"
  );
}

function notFound(): AppError {
  return new AppError({
    code: "CLOUD_ACCOUNT_NOT_FOUND",
    message: "The cloud account was not found.",
    statusCode: 404,
    details: [],
  });
}

function conflict(code: "CLOUD_ACCOUNT_CONFLICT" | "CLOUD_ACCOUNT_VERSION_CONFLICT"): AppError {
  return new AppError({
    code,
    message:
      code === "CLOUD_ACCOUNT_CONFLICT"
        ? "A cloud account conflicts with existing metadata."
        : "The cloud account changed before this update.",
    statusCode: 409,
    details: [],
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "CLOUD_ACCOUNTS_UNAVAILABLE",
    message: "Cloud account management is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
