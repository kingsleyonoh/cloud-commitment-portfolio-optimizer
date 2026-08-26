import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { ApprovalsService } from "../../../core/approvals/approvals-service.js";
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
  approvalDecisionBodySchema,
  approvalDetailSchema,
  approvalPathSchema,
  approvalRequestBodySchema,
  approvalSchema,
  approvalsListQuerySchema,
  approvalsListResponseSchema,
  approvalsResponseSchemas,
} from "./approvals-schema.js";

export interface ApprovalsRuntime {
  limiter: ProtectedUsersLimiter;
  service: ApprovalsService;
}

export function registerApprovalsRoutes(app: FastifyInstance, runtime: ApprovalsRuntime): void {
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/recommendations/:id/request-approval",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/recommendations/{id}/request-approval",
        "recommendations.request_approval",
      ),
      schema: {
        params: approvalPathSchema,
        body: approvalRequestBodySchema,
        response: { 201: approvalSchema, ...approvalsResponseSchemas },
      },
    },
    async (request, reply) => {
      const approval = await runtime.service.requestApproval(
        requestContext(request.authContext),
        request.params.id,
        request.body,
      );
      return reply.code(201).send(approval);
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/approvals",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/approvals", "approvals.read"),
      schema: {
        querystring: approvalsListQuerySchema,
        response: { 200: approvalsListResponseSchema, ...approvalsResponseSchemas },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );

  app.get<{ Params: { id: string } }>(
    "/api/approvals/:id",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/approvals/{id}", "approvals.read"),
      schema: {
        params: approvalPathSchema,
        response: { 200: approvalDetailSchema, ...approvalsResponseSchemas },
      },
    },
    async (request) => runtime.service.get(requestContext(request.authContext), request.params.id),
  );

  for (const decision of ["approve", "reject"] as const) {
    app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
      `/api/approvals/:id/${decision}`,
      {
        preHandler: protectedBoundary(
          app,
          runtime,
          "POST",
          `/api/approvals/{id}/${decision}`,
          "recommendations.approve_reject",
        ),
        schema: {
          params: approvalPathSchema,
          body: approvalDecisionBodySchema,
          response: { 200: approvalDetailSchema, ...approvalsResponseSchemas },
        },
      },
      async (request) =>
        decision === "approve"
          ? runtime.service.approve(
              requestContext(request.authContext),
              request.params.id,
              request.body,
            )
          : runtime.service.reject(
              requestContext(request.authContext),
              request.params.id,
              request.body,
            ),
    );
  }
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: ApprovalsRuntime,
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
    message: "Too many approval requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
