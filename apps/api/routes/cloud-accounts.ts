import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type { CloudAccountsService } from "../../../core/tenant/cloud-accounts-service.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { AuthAction } from "../../../core/tenant/rbac.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import {
  cloudAccountCreateBodySchema,
  cloudAccountDeactivateBodySchema,
  cloudAccountPatchBodySchema,
  cloudAccountPathSchema,
  cloudAccountsListQuerySchema,
  cloudAccountsListResponseSchema,
  cloudAccountSchema,
  cloudAccountsResponseSchemas,
} from "./cloud-accounts-schema.js";

export interface CloudAccountsRuntime {
  limiter: ProtectedUsersLimiter;
  service: CloudAccountsService;
}

export function registerCloudAccountsRoutes(
  app: FastifyInstance,
  runtime: CloudAccountsRuntime,
): void {
  registerListRoute(app, runtime);
  registerCreateRoute(app, runtime);
  registerPatchRoute(app, runtime);
  registerDeactivateRoute(app, runtime);
}

function registerListRoute(app: FastifyInstance, runtime: CloudAccountsRuntime): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/cloud-accounts",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/cloud-accounts",
        "cloud_accounts.read",
      ),
      schema: {
        querystring: cloudAccountsListQuerySchema,
        response: {
          200: cloudAccountsListResponseSchema,
          ...cloudAccountsResponseSchemas,
        },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );
}

function registerCreateRoute(app: FastifyInstance, runtime: CloudAccountsRuntime): void {
  app.post<{ Body: unknown }>(
    "/api/cloud-accounts",
    {
      bodyLimit: 16 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/cloud-accounts",
        "cloud_accounts.create_update",
      ),
      schema: {
        body: cloudAccountCreateBodySchema,
        response: {
          201: cloudAccountSchema,
          ...cloudAccountsResponseSchemas,
        },
      },
    },
    async (request, reply) => {
      const account = await runtime.service.create(
        requestContext(request.authContext),
        request.body,
      );
      return reply.code(201).send(account);
    },
  );
}

function registerPatchRoute(app: FastifyInstance, runtime: CloudAccountsRuntime): void {
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/cloud-accounts/:id",
    {
      bodyLimit: 16 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "PATCH",
        "/api/cloud-accounts/{id}",
        "cloud_accounts.create_update",
        true,
      ),
      schema: {
        params: cloudAccountPathSchema,
        body: cloudAccountPatchBodySchema,
        response: {
          200: cloudAccountSchema,
          ...cloudAccountsResponseSchemas,
        },
      },
    },
    async (request) =>
      runtime.service.patch(requestContext(request.authContext), request.params.id, request.body),
  );
}

function registerDeactivateRoute(app: FastifyInstance, runtime: CloudAccountsRuntime): void {
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/cloud-accounts/:id/deactivate",
    {
      bodyLimit: 16 * 1024,
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/cloud-accounts/{id}/deactivate",
        "cloud_accounts.deactivate",
        true,
      ),
      schema: {
        params: cloudAccountPathSchema,
        body: cloudAccountDeactivateBodySchema,
        response: {
          200: cloudAccountSchema,
          ...cloudAccountsResponseSchemas,
        },
      },
    },
    async (request) =>
      runtime.service.deactivate(
        requestContext(request.authContext),
        request.params.id,
        request.body,
      ),
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: CloudAccountsRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  action: AuthAction,
  targetScoped = false,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction(action),
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const target = targetScoped ? (request.params as { id?: unknown }).id : undefined;
      const decision = await runtime.limiter.admit(
        context,
        method,
        route,
        typeof target === "string" ? target : undefined,
      );
      if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds, route);
    },
  ];
}

function requestContext(context: unknown): RequestContext {
  if (!context || typeof context !== "object") throw authError("FORBIDDEN");
  const actorType = (context as { actorType?: unknown }).actorType;
  if (actorType !== "user" && actorType !== "api_key") throw authError("FORBIDDEN");
  return context as RequestContext;
}

function rateLimited(
  reply: FastifyReply,
  retryAfterSeconds = 1,
  route?: ProtectedUsersRoute,
): FastifyReply {
  reply.header("retry-after", String(Math.max(1, retryAfterSeconds)));
  const error = new AppError({
    code: "RATE_LIMITED",
    message:
      route === "/api/cloud-accounts/{id}/deactivate"
        ? "Too many cloud account deactivation requests."
        : "Too many cloud account requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
