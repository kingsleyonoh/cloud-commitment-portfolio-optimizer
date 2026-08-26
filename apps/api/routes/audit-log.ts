import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { AuditService } from "../../../core/audit/audit-service.js";
import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { AuthAction } from "../../../core/tenant/rbac.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import { renderAuditLogPage } from "../../web/audit-log-page.js";
import {
  auditLogListQuerySchema,
  auditLogListResponseSchema,
  auditLogResponseSchemas,
} from "./audit-log-schema.js";

export interface AuditLogRuntime {
  limiter: ProtectedUsersLimiter;
  service: AuditService;
}

export function registerAuditLogRoutes(app: FastifyInstance, runtime: AuditLogRuntime): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/audit-log",
    {
      preHandler: boundary(app, runtime, "GET", "/api/audit-log", "audit_log.read"),
      schema: {
        querystring: auditLogListQuerySchema,
        response: { 200: auditLogListResponseSchema, ...auditLogResponseSchemas },
      },
    },
    async (request) => runtime.service.list(userContext(request.authContext), request.query),
  );

  app.get(
    "/audit-log",
    {
      preHandler: boundary(app, runtime, "GET", "/api/audit-log", "audit_log.read"),
    },
    async (request, reply) => {
      const context = userContext(request.authContext);
      const page = await runtime.service.list(context, {
        ...(request.query as Record<string, unknown>),
        limit: "100",
      });
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(renderAuditLogPage({ audit: page.audit, role: context.role }));
    },
  );
}

function boundary(
  app: FastifyInstance,
  runtime: AuditLogRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  action: AuthAction,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction(action),
    async (request, reply) => {
      const decision = await runtime.limiter.admit(userContext(request.authContext), method, route);
      if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds);
    },
  ];
}

function userContext(value: unknown): RequestContext & { actorType: "user" } {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { actorType?: unknown }).actorType !== "user"
  ) {
    throw authError("FORBIDDEN");
  }
  return value as RequestContext & { actorType: "user" };
}

function rateLimited(reply: FastifyReply, retryAfterSeconds = 1): FastifyReply {
  reply.header("retry-after", String(Math.max(1, retryAfterSeconds)));
  return reply.code(429).send(
    toErrorEnvelope(
      new AppError({
        code: "RATE_LIMITED",
        message: "Too many audit-log requests.",
        statusCode: 429,
      }),
    ),
  );
}
