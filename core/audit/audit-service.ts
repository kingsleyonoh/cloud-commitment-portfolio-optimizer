import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import { encodeAuditCursor } from "./audit-cursor.js";
import { parseAuditListQuery } from "./audit-input.js";
import type { AuditRepository } from "./audit-repository.js";
import type { Audit, AuditListInput, AuditRecord } from "./audit-types.js";

export interface AuditService {
  list(
    context: RequestContext,
    query: unknown,
  ): Promise<{ audit: readonly Audit[]; next_cursor: string | null }>;
}

export function createAuditService(repository: AuditRepository): AuditService {
  return { list: (context, query) => list(repository, context, query) };
}

async function list(
  repository: AuditRepository,
  context: RequestContext,
  query: unknown,
): Promise<{ audit: readonly Audit[]; next_cursor: string | null }> {
  if (
    context.actorType !== "user" ||
    (context.role !== "tenant_admin" && context.role !== "read_only_auditor")
  ) {
    throw new AppError({ code: "FORBIDDEN", message: "Access denied.", statusCode: 403 });
  }
  const parsed = parseAuditListQuery(query);
  const rows = await safe(() =>
    repository.list(context.tenantId, {
      ...parsed,
    } as AuditListInput),
  );
  const page = rows.slice(0, parsed.limit);
  const last = page.at(-1);
  return {
    audit: page.map(toAudit),
    next_cursor:
      rows.length > parsed.limit && last
        ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

function toAudit(row: AuditRecord): Audit {
  return {
    id: row.id,
    actor_user_id: row.actorUserId,
    actor_type: row.actorType,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    old_values: sanitizeValues(row.oldValues),
    new_values: sanitizeValues(row.newValues),
    request_id: row.requestId,
    created_at: row.createdAt,
  };
}

function sanitizeValues(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  return sanitizeRecord(value);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      /(?:password|secret|token|credential|authorization|cookie|private.?key|api.?key|hash|digest)/iu.test(
        key,
      )
    ) {
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      result[key] = sanitizeRecord(item as Record<string, unknown>);
    } else if (Array.isArray(item)) {
      result[key] = item.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? sanitizeRecord(entry as Record<string, unknown>)
          : entry,
      );
    } else {
      result[key] = item;
    }
  }
  return Object.freeze(result);
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "AUDIT_LOG_UNAVAILABLE",
      message: "The audit log is temporarily unavailable.",
      statusCode: 503,
    });
  }
}
