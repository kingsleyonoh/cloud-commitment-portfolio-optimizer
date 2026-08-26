import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { PriceTablesService } from "../../../core/price-tables/price-tables-service.js";
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
  emptyBodySchema,
  priceTableCreateBodySchema,
  priceTablePathSchema,
  priceTableSchema,
  priceTablesListQuerySchema,
  priceTablesListResponseSchema,
  priceTablesResponseSchemas,
} from "./price-tables-schema.js";
import { renderPriceTablesPage } from "../../web/price-tables-page.js";

export interface PriceTablesRuntime {
  limiter: ProtectedUsersLimiter;
  service: PriceTablesService;
}

export function registerPriceTablesRoutes(app: FastifyInstance, runtime: PriceTablesRuntime): void {
  registerPriceTablesPage(app, runtime);
  registerListRoute(app, runtime);
  registerCreateRoute(app, runtime);
  registerActivateRoute(app, runtime);
}

function registerPriceTablesPage(app: FastifyInstance, runtime: PriceTablesRuntime): void {
  app.get(
    "/price-tables",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/price-tables", "price_tables.read"),
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const page = await runtime.service.list(context, { limit: "100" });
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(renderPriceTablesPage({ priceTables: page.price_tables, role: context.role }));
    },
  );
}

function registerListRoute(app: FastifyInstance, runtime: PriceTablesRuntime): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/price-tables",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/price-tables", "price_tables.read"),
      schema: {
        querystring: priceTablesListQuerySchema,
        response: {
          200: priceTablesListResponseSchema,
          ...priceTablesResponseSchemas,
        },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );
}

function registerCreateRoute(app: FastifyInstance, runtime: PriceTablesRuntime): void {
  app.post<{ Body: unknown }>(
    "/api/price-tables",
    {
      bodyLimit: 1024 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/price-tables",
        "price_tables.create_activate",
      ),
      schema: {
        body: priceTableCreateBodySchema,
        response: {
          201: priceTableSchema,
          ...priceTablesResponseSchemas,
        },
      },
    },
    async (request, reply) => {
      const version = await runtime.service.create(
        requestContext(request.authContext),
        request.body,
      );
      return reply.code(201).send(version);
    },
  );
}

function registerActivateRoute(app: FastifyInstance, runtime: PriceTablesRuntime): void {
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/price-tables/:id/activate",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/price-tables/{id}/activate",
        "price_tables.create_activate",
      ),
      schema: {
        params: priceTablePathSchema,
        body: emptyBodySchema,
        response: {
          200: priceTableSchema,
          ...priceTablesResponseSchemas,
        },
      },
    },
    async (request) =>
      runtime.service.activate(requestContext(request.authContext), request.params.id),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: PriceTablesRuntime,
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
    message: "Too many price table requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
