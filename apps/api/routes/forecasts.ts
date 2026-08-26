import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { ForecastService } from "../../../core/forecasting/forecast-service.js";
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
  forecastModelCreateBodySchema,
  forecastModelSchema,
  forecastModelsListQuerySchema,
  forecastModelsListResponseSchema,
  forecastPathSchema,
  forecastResponseSchemas,
  forecastRunCreateBodySchema,
  forecastRunSchema,
  forecastRunsListQuerySchema,
  forecastRunsListResponseSchema,
} from "./forecasts-schema.js";

export interface ForecastsRuntime {
  limiter: ProtectedUsersLimiter;
  service: ForecastService;
}

export function registerForecastRoutes(app: FastifyInstance, runtime: ForecastsRuntime): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/forecast-models",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/forecast-models",
        "forecast_models.read",
      ),
      schema: {
        querystring: forecastModelsListQuerySchema,
        response: { 200: forecastModelsListResponseSchema, ...forecastResponseSchemas },
      },
    },
    async (request) =>
      runtime.service.listModels(requestContext(request.authContext), request.query),
  );
  app.post<{ Body: unknown }>(
    "/api/forecast-models",
    {
      bodyLimit: 1024 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/forecast-models",
        "forecast_models.write",
      ),
      schema: {
        body: forecastModelCreateBodySchema,
        response: { 201: forecastModelSchema, ...forecastResponseSchemas },
      },
    },
    async (request, reply) => {
      const model = await runtime.service.createModel(
        requestContext(request.authContext),
        request.body,
      );
      return reply.code(201).send(model);
    },
  );
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/forecast-runs",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/forecast-runs",
        "forecast_runs.read",
      ),
      schema: {
        querystring: forecastRunsListQuerySchema,
        response: { 200: forecastRunsListResponseSchema, ...forecastResponseSchemas },
      },
    },
    async (request) => runtime.service.listRuns(requestContext(request.authContext), request.query),
  );
  app.post<{ Body: unknown }>(
    "/api/forecast-runs",
    {
      bodyLimit: 1024 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/forecast-runs",
        "forecast_runs.run",
      ),
      schema: {
        body: forecastRunCreateBodySchema,
        response: { 201: forecastRunSchema, ...forecastResponseSchemas },
      },
    },
    async (request, reply) => {
      const run = await runtime.service.createRun(
        requestContext(request.authContext),
        request.body,
      );
      return reply.code(201).send(run);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/forecast-runs/:id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/forecast-runs/{id}",
        "forecast_runs.read",
      ),
      schema: {
        params: forecastPathSchema,
        response: { 200: forecastRunSchema, ...forecastResponseSchemas },
      },
    },
    async (request) =>
      runtime.service.getRun(requestContext(request.authContext), request.params.id),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: ForecastsRuntime,
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
    message: "Too many forecast requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
