import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { RecommendationsService } from "../../../core/recommendations/recommendations-service.js";
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
  recommendationDetailSchema,
  recommendationPathSchema,
  recommendationsListQuerySchema,
  recommendationsListResponseSchema,
  recommendationsResponseSchemas,
} from "./recommendations-schema.js";

export interface RecommendationsRuntime {
  limiter: ProtectedUsersLimiter;
  service: RecommendationsService;
}

export function registerRecommendationsRoutes(
  app: FastifyInstance,
  runtime: RecommendationsRuntime,
): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/recommendations",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/recommendations",
        "recommendations.read",
      ),
      schema: {
        querystring: recommendationsListQuerySchema,
        response: { 200: recommendationsListResponseSchema, ...recommendationsResponseSchemas },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );

  app.get<{ Params: { id: string } }>(
    "/api/recommendations/:id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/recommendations/{id}",
        "recommendations.read",
      ),
      schema: {
        params: recommendationPathSchema,
        response: { 200: recommendationDetailSchema, ...recommendationsResponseSchemas },
      },
    },
    async (request) => runtime.service.get(requestContext(request.authContext), request.params.id),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: RecommendationsRuntime,
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
    message: "Too many recommendation requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
