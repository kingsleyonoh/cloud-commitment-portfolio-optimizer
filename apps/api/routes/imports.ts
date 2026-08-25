import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { ImportsService } from "../../../core/imports/imports-service.js";
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
  importBatchSchema,
  importCreateBodySchema,
  importPathSchema,
  importsListQuerySchema,
  importsListResponseSchema,
  importsResponseSchemas,
} from "./imports-schema.js";

export interface ImportsRuntime {
  limiter: ProtectedUsersLimiter;
  service: ImportsService;
}

export function registerImportsRoutes(app: FastifyInstance, runtime: ImportsRuntime): void {
  registerListRoute(app, runtime);
  registerCreateRoute(app, runtime);
  registerGetRoute(app, runtime);
}

function registerListRoute(app: FastifyInstance, runtime: ImportsRuntime): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/imports",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/imports", "imports.read"),
      schema: {
        querystring: importsListQuerySchema,
        response: {
          200: importsListResponseSchema,
          ...importsResponseSchemas,
        },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );
}

function registerCreateRoute(app: FastifyInstance, runtime: ImportsRuntime): void {
  app.post<{ Body: unknown }>(
    "/api/imports",
    {
      bodyLimit: 1024 * 1024,
      preHandler: protectedBoundary(app, runtime, "POST", "/api/imports", "imports.write"),
      schema: {
        body: importCreateBodySchema,
        response: {
          201: importBatchSchema,
          ...importsResponseSchemas,
        },
      },
    },
    async (request, reply) => {
      const batch = await runtime.service.create(requestContext(request.authContext), request.body);
      return reply.code(201).send(batch);
    },
  );
}

function registerGetRoute(app: FastifyInstance, runtime: ImportsRuntime): void {
  app.get<{ Params: { id: string } }>(
    "/api/imports/:id",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/imports/{id}", "imports.read"),
      schema: {
        params: importPathSchema,
        response: {
          200: importBatchSchema,
          ...importsResponseSchemas,
        },
      },
    },
    async (request) => runtime.service.get(requestContext(request.authContext), request.params.id),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: ImportsRuntime,
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
    message: "Too many import requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
