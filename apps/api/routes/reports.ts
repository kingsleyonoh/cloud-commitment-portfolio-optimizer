import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { ReportsService } from "../../../core/reports/reports-service.js";
import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { AuthAction } from "../../../core/tenant/rbac.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import {
  reportPathSchema,
  reportResponseSchema,
  reportsResponseSchemas,
} from "./reports-schema.js";

export interface ReportsRuntime {
  limiter: ProtectedUsersLimiter;
  service: ReportsService;
}

export function registerReportsRoutes(app: FastifyInstance, runtime: ReportsRuntime): void {
  app.get<{ Params: { source_type: string; source_id: string } }>(
    "/api/reports/:source_type/:source_id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/reports/{source_type}/{source_id}",
        "reports.read",
      ),
      schema: {
        params: reportPathSchema,
        response: { 200: reportResponseSchema, ...reportsResponseSchemas },
      },
    },
    async (request) =>
      runtime.service.get(
        requestContext(request.authContext),
        request.params.source_type,
        request.params.source_id,
      ),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: ReportsRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  action: AuthAction,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction(action),
    async (request, reply) => {
      const decision = await runtime.limiter.admit(
        requestContext(request.authContext),
        method,
        route,
      );
      if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds);
    },
  ];
}

function requestContext(context: unknown): RequestContext {
  if (!context || typeof context !== "object") throw authError("FORBIDDEN");
  const actorType = (context as { actorType?: unknown }).actorType;
  if (actorType !== "user" && actorType !== "api_key") throw authError("FORBIDDEN");
  return context as RequestContext;
}

function rateLimited(reply: FastifyReply, retryAfterSeconds = 1): FastifyReply {
  reply.header("retry-after", String(Math.max(1, retryAfterSeconds)));
  const error = new AppError({
    code: "RATE_LIMITED",
    message: "Too many report requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
