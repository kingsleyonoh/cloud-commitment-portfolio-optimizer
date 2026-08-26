import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { BacktestsService } from "../../../core/backtests/backtests-service.js";
import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { AuthAction } from "../../../core/tenant/rbac.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import { renderBacktestDetailPage, renderBacktestsPage } from "../../web/backtests-page.js";
import {
  backtestCreateBodySchema,
  backtestDetailSchema,
  backtestPathSchema,
  backtestRunSchema,
  backtestsListQuerySchema,
  backtestsListResponseSchema,
  backtestsResponseSchemas,
} from "./backtests-schema.js";

export interface BacktestsRuntime {
  limiter: ProtectedUsersLimiter;
  service: BacktestsService;
}

export function registerBacktestsRoutes(app: FastifyInstance, runtime: BacktestsRuntime): void {
  registerBacktestPages(app, runtime);

  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/backtests",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/backtests", "backtests.read_run"),
      schema: {
        querystring: backtestsListQuerySchema,
        response: { 200: backtestsListResponseSchema, ...backtestsResponseSchemas },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );

  app.post<{ Body: unknown }>(
    "/api/backtests",
    {
      bodyLimit: 1024 * 1024,
      preHandler: [
        ...protectedBoundary(app, runtime, "POST", "/api/backtests", "backtests.read_run"),
        async (request) => requireBacktestMutationActor(requestContext(request.authContext)),
      ],
      schema: {
        body: backtestCreateBodySchema,
        response: { 201: backtestRunSchema, ...backtestsResponseSchemas },
      },
    },
    async (request, reply) => {
      const run = await runtime.service.create(requestContext(request.authContext), request.body);
      return reply.code(201).send(run);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/backtests/:id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/backtests/{id}",
        "backtests.read_run",
      ),
      schema: {
        params: backtestPathSchema,
        response: { 200: backtestDetailSchema, ...backtestsResponseSchemas },
      },
    },
    async (request) => runtime.service.get(requestContext(request.authContext), request.params.id),
  );
}

function registerBacktestPages(app: FastifyInstance, runtime: BacktestsRuntime): void {
  app.get(
    "/backtests",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/backtests", "backtests.read_run"),
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const page = await runtime.service.list(context, { limit: "100" });
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(renderBacktestsPage({ backtests: page.backtests, role: context.role }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/backtests/:id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/backtests/{id}",
        "backtests.read_run",
      ),
      schema: { params: backtestPathSchema },
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const detail = await runtime.service.get(context, request.params.id);
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(renderBacktestDetailPage({ detail, role: context.role }));
    },
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: BacktestsRuntime,
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

function requireBacktestMutationActor(context: RequestContext): void {
  if (context.actorType === "api_key") return;
  if (context.role === "tenant_admin" || context.role === "finops_analyst") return;
  throw authError("FORBIDDEN");
}

function rateLimited(reply: FastifyReply, retryAfterSeconds = 1): FastifyReply {
  reply.header("retry-after", String(Math.max(1, retryAfterSeconds)));
  const error = new AppError({
    code: "RATE_LIMITED",
    message: "Too many backtest requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
