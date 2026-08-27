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
import { renderNotificationSettingsPage } from "../../web/notification-settings-page.js";
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
  registerNotificationSettingsPage(app, runtime);

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

function registerNotificationSettingsPage(
  app: FastifyInstance,
  runtime: NotificationsRuntime,
): void {
  registerFormParser(app);
  app.get(
    "/settings/notifications",
    {
      preHandler: boundary(
        app,
        runtime,
        "GET",
        "/api/settings/notifications",
        "notification_preferences.write",
      ),
    },
    async (request, reply) => {
      const user = userContext(request.authContext);
      const result = await runtime.service.listPreferences(user);
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(
          renderNotificationSettingsPage({
            preferences: result.preferences,
            role: user.role,
            csrfToken: browserCsrfCookie(request.cookies),
          }),
        );
    },
  );

  app.post<{ Body: unknown }>(
    "/settings/notifications",
    {
      bodyLimit: 32 * 1024,
      preHandler: boundary(
        app,
        runtime,
        "PUT",
        "/api/settings/notifications",
        "notification_preferences.write",
      ),
    },
    async (request, reply) => {
      await runtime.service.updatePreferences(
        userContext(request.authContext),
        parseNotificationForm(request.body),
      );
      return reply.code(303).header("location", "/settings/notifications").send("");
    },
  );
}

function registerFormParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser("application/x-www-form-urlencoded")) return;
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 32 * 1024 },
    (_request, body, done) => done(null, parseFormBody(body)),
  );
}

function parseFormBody(body: string | Buffer): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(
    Buffer.isBuffer(body) ? body.toString("utf8") : body,
  )) {
    const previous = result[key];
    result[key] =
      previous === undefined
        ? value
        : Array.isArray(previous)
          ? [...previous, value]
          : [previous, value];
  }
  return result;
}

function parseNotificationForm(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const object = body as Record<string, unknown>;
  const eventTypes = values(object.event_type);
  const channels = values(object.channel);
  const urgencies = values(object.urgency);
  return {
    preferences: eventTypes.map((eventType, index) => ({
      event_type: eventType,
      channel: channels[index],
      urgency: urgencies[index],
      enabled: object[`enabled_${index}`] === "true",
    })),
  };
}

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function browserCsrfCookie(
  cookies: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return cookies.ccpo_csrf ?? cookies["__Host-ccpo_csrf"];
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

function userContext(value: unknown): RequestContext & { actorType: "user" } {
  const result = context(value);
  if (result.actorType !== "user") throw authError("FORBIDDEN");
  return result;
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
