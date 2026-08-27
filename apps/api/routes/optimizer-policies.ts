import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { OptimizerPoliciesService } from "../../../core/optimizer-policies/optimizer-policies-service.js";
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
  optimizerPoliciesListQuerySchema,
  optimizerPoliciesListResponseSchema,
  optimizerPoliciesResponseSchemas,
  optimizerPolicyCreateBodySchema,
  optimizerPolicyPatchBodySchema,
  optimizerPolicyPathSchema,
  optimizerPolicySchema,
} from "./optimizer-policies-schema.js";

export interface OptimizerPoliciesRuntime {
  limiter: ProtectedUsersLimiter;
  service: OptimizerPoliciesService;
}

export function registerOptimizerPoliciesRoutes(
  app: FastifyInstance,
  runtime: OptimizerPoliciesRuntime,
): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/optimizer-policies",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/optimizer-policies",
        "optimizer_policies.read",
      ),
      schema: {
        querystring: optimizerPoliciesListQuerySchema,
        response: { 200: optimizerPoliciesListResponseSchema, ...optimizerPoliciesResponseSchemas },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );

  app.post<{ Body: unknown }>(
    "/api/optimizer-policies",
    {
      bodyLimit: 1024 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/optimizer-policies",
        "optimizer_policies.write",
      ),
      schema: {
        body: optimizerPolicyCreateBodySchema,
        response: { 201: optimizerPolicySchema, ...optimizerPoliciesResponseSchemas },
      },
    },
    async (request, reply) => {
      const policy = await runtime.service.create(
        requestContext(request.authContext),
        request.body,
      );
      return reply.code(201).send(policy);
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/optimizer-policies/:id",
    {
      bodyLimit: 1024 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "PATCH",
        "/api/optimizer-policies/{id}",
        "optimizer_policies.write",
      ),
      schema: {
        params: optimizerPolicyPathSchema,
        body: optimizerPolicyPatchBodySchema,
        response: { 200: optimizerPolicySchema, ...optimizerPoliciesResponseSchemas },
      },
    },
    async (request) =>
      runtime.service.patch(requestContext(request.authContext), request.params.id, request.body),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: OptimizerPoliciesRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  action: AuthAction,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction(action),
    async (request, reply) => {
      const context = requestContext(request.authContext);
      if (context.actorType !== "user") throw authError("FORBIDDEN");
      const decision = await runtime.limiter.admit(context, method, route);
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
    message: "Too many optimizer policy requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
