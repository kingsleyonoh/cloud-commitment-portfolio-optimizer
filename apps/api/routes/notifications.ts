import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { NotificationsService } from "../../../core/notifications/notifications-service.js";
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
  notificationPathSchema,
  notificationPreferencesBodySchema,
  notificationPreferencesResponseSchema,
  notificationSchema,
  notificationsListQuerySchema,
  notificationsListResponseSchema,
  notificationsResponseSchemas,
} from "./notifications-schema.js";

export interface NotificationsRuntime {
  limiter: ProtectedUsersLimiter;
  service: NotificationsService;
}

export function registerNotificationsRoutes(
  app: FastifyInstance,
  runtime: NotificationsRuntime,
): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/notifications",
    {
      preHandler: boundary(app, runtime, "GET", "/api/notifications", "notifications.read"),
      schema: {
        querystring: notificationsListQuerySchema,
        response: { 200: notificationsListResponseSchema, ...notificationsResponseSchemas },
      },
    },
    async (request) => runtime.service.list(context(request.authContext), request.query),
  );

  app.post<{ Params: { id: string } }>(
    "/api/notifications/:id/read",
    {
      preHandler: boundary(
        app,
        runtime,
        "POST",
        "/api/notifications/{id}/read",
        "notifications.read",
      ),
      schema: {
        params: notificationPathSchema,
        response: { 200: notificationSchema, ...notificationsResponseSchemas },
      },
    },
    async (request) => runtime.service.markRead(context(request.authContext), request.params.id),
  );

  app.get(
    "/api/settings/notifications",
    {
      preHandler: boundary(
        app,
        runtime,
        "GET",
        "/api/settings/notifications",
        "notification_preferences.write",
      ),
      schema: {
        response: { 200: notificationPreferencesResponseSchema, ...notificationsResponseSchemas },
      },
    },
    async (request) => runtime.service.listPreferences(context(request.authContext)),
  );

  app.put<{ Body: unknown }>(
    "/api/settings/notifications",
    {
      bodyLimit: 64 * 1024,
      preHandler: boundary(
        app,
        runtime,
        "PUT",
        "/api/settings/notifications",
        "notification_preferences.write",
      ),
      schema: {
        body: notificationPreferencesBodySchema,
        response: { 200: notificationPreferencesResponseSchema, ...notificationsResponseSchemas },
      },
    },
    async (request) =>
      runtime.service.updatePreferences(context(request.authContext), request.body),
  );
}

function boundary(
  app: FastifyInstance,
  runtime: NotificationsRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  action: AuthAction,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction(action),
    async (request, reply) => {
      const decision = await runtime.limiter.admit(context(request.authContext), method, route);
      if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds);
    },
  ];
}

function context(value: unknown): RequestContext {
  if (!value || typeof value !== "object") throw authError("FORBIDDEN");
  const actorType = (value as { actorType?: unknown }).actorType;
  if (actorType !== "user" && actorType !== "api_key") throw authError("FORBIDDEN");
  return value as RequestContext;
}

function rateLimited(reply: FastifyReply, retryAfterSeconds = 1): FastifyReply {
  reply.header("retry-after", String(Math.max(1, retryAfterSeconds)));
  return reply.code(429).send(
    toErrorEnvelope(
      new AppError({
        code: "RATE_LIMITED",
        message: "Too many notification requests.",
        statusCode: 429,
      }),
    ),
  );
}
