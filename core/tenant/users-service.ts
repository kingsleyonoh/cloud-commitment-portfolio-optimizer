import { AppError } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { UserRequestContext } from "./request-context.js";
import { decodeUsersCursor, encodeUsersCursor } from "./users-cursor.js";
import {
  normalizeUserCreate,
  normalizeUserPatch,
  parseUserId,
  parseUserListQuery,
} from "./users-input.js";
import type { UsersRepository } from "./users-repository.js";
import type { TenantUser, UserListPage, UserRecord } from "./users-types.js";

export interface UsersService {
  list(context: UserRequestContext, query: unknown): Promise<UserListPage>;
  create(context: UserRequestContext, body: unknown): Promise<TenantUser>;
  patch(context: UserRequestContext, userId: unknown, body: unknown): Promise<TenantUser>;
}

export function createUsersService(repository: UsersRepository, logger: Logger): UsersService {
  return {
    list: (context, query) => listUsers(repository, context, query),
    create: (context, body) => createUser(repository, logger, context, body),
    patch: (context, userId, body) => patchUser(repository, logger, context, userId, body),
  };
}

async function listUsers(
  repository: UsersRepository,
  context: UserRequestContext,
  query: unknown,
): Promise<UserListPage> {
  const parsed = parseUserListQuery(query);
  const cursor = parsed.cursor ? decodeUsersCursor(parsed.cursor) : undefined;
  let rows: UserRecord[];
  try {
    rows = await repository.list({
      tenantId: context.tenantId,
      limit: parsed.limit,
      ...(cursor ? { cursor } : {}),
    });
  } catch {
    throw unavailable();
  }
  const selected = rows.slice(0, parsed.limit);
  const last = selected.at(-1);
  return {
    users: selected.map(toTenantUser),
    next_cursor: rows.length > parsed.limit && last ? encodeUsersCursor(last) : null,
  };
}

async function createUser(
  repository: UsersRepository,
  logger: Logger,
  context: UserRequestContext,
  body: unknown,
): Promise<TenantUser> {
  const input = normalizeUserCreate(body);
  let row: UserRecord;
  try {
    row = await repository.create(context.tenantId, input);
  } catch (error) {
    if (isEmailConflict(error)) throw conflict();
    throw unavailable();
  }
  await mutationEvent(logger, context, row, ["email", "name", "role", "is_active"]);
  return toTenantUser(row);
}

async function patchUser(
  repository: UsersRepository,
  logger: Logger,
  context: UserRequestContext,
  userId: unknown,
  body: unknown,
): Promise<TenantUser> {
  const id = parseUserId(userId);
  const input = normalizeUserPatch(body);
  let result;
  try {
    result = await repository.patch({
      tenantId: context.tenantId,
      userId: id,
      expectedUpdatedAt: input.expectedUpdatedAt,
      changes: input.changes,
    });
  } catch (error) {
    if (isEmailConflict(error)) throw conflict();
    throw unavailable();
  }
  if (result.kind === "not_found") throw userError("USER_NOT_FOUND");
  if (result.kind === "version_conflict") throw userError("USER_VERSION_CONFLICT");
  if (result.kind === "last_admin") throw userError("LAST_TENANT_ADMIN_REQUIRED");
  await mutationEvent(logger, context, result.user, input.changedFields);
  return toTenantUser(result.user);
}

function toTenantUser(row: UserRecord): TenantUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function mutationEvent(
  logger: Logger,
  context: UserRequestContext,
  row: UserRecord,
  changedFields: readonly string[],
): Promise<void> {
  await logger.info("users.mutation.succeeded", {
    requestId: context.requestId,
    tenantId: context.tenantId,
    actorUserId: context.actorUserId,
    targetUserId: row.id,
    changedFields,
    resultCode: "success",
    resultingUpdatedAt: row.updatedAt,
  });
}

function isEmailConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; constraint?: unknown };
  return value.code === "23505" && value.constraint === "users_tenant_email_key";
}

function conflict(): AppError {
  return new AppError({
    code: "USER_CONFLICT",
    message: "A user conflicts with existing metadata.",
    statusCode: 409,
    details: [],
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "USERS_UNAVAILABLE",
    message: "User management is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}

function userError(
  code: "USER_NOT_FOUND" | "USER_VERSION_CONFLICT" | "LAST_TENANT_ADMIN_REQUIRED",
): AppError {
  const contract = {
    USER_NOT_FOUND: [404, "The user was not found."],
    USER_VERSION_CONFLICT: [409, "The user changed before this update."],
    LAST_TENANT_ADMIN_REQUIRED: [409, "At least one active tenant administrator is required."],
  } as const;
  const [statusCode, message] = contract[code];
  return new AppError({ code, message, statusCode, details: [] });
}
