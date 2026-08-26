import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { OptimizerRunsService } from "../../../core/optimizer-runs/optimizer-runs-service.js";
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
  optimizerRunCreateBodySchema,
  optimizerRunDetailSchema,
  optimizerRunPathSchema,
  optimizerRunSchema,
  optimizerRunsListQuerySchema,
  optimizerRunsListResponseSchema,
  optimizerRunsResponseSchemas,
} from "./optimizer-runs-schema.js";
import { renderOptimizerRunsPage } from "../../web/optimizer-runs-page.js";

export interface OptimizerRunsRuntime {
  limiter: ProtectedUsersLimiter;
  service: OptimizerRunsService;
}

export function registerOptimizerRunsRoutes(
  app: FastifyInstance,
  runtime: OptimizerRunsRuntime,
): void {
  app.get(
    "/optimizer-runs",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/optimizer-runs",
        "optimizer_runs.read",
      ),
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const page = await runtime.service.list(context, { limit: "100" });
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(renderOptimizerRunsPage({ runs: page.optimizer_runs, role: context.role }));
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/optimizer-runs",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/optimizer-runs",
        "optimizer_runs.read",
      ),
      schema: {
        querystring: optimizerRunsListQuerySchema,
        response: { 200: optimizerRunsListResponseSchema, ...optimizerRunsResponseSchemas },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );

  app.post<{ Body: unknown }>(
    "/api/optimizer-runs",
    {
      bodyLimit: 1024 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/optimizer-runs",
        "optimizer_runs.run",
      ),
      schema: {
        body: optimizerRunCreateBodySchema,
        response: { 201: optimizerRunSchema, ...optimizerRunsResponseSchemas },
      },
    },
    async (request, reply) => {
      const run = await runtime.service.create(requestContext(request.authContext), request.body);
      return reply.code(201).send(run);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/optimizer-runs/:id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/optimizer-runs/{id}",
        "optimizer_runs.read",
      ),
      schema: {
        params: optimizerRunPathSchema,
        response: { 200: optimizerRunDetailSchema, ...optimizerRunsResponseSchemas },
      },
    },
    async (request) => runtime.service.get(requestContext(request.authContext), request.params.id),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: OptimizerRunsRuntime,
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
    message: "Too many optimizer run requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
