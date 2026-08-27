import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { EcosystemAdaptersService } from "../../../core/adapters/ecosystem-service.js";
import type { EcosystemTarget } from "../../../core/adapters/ecosystem-types.js";
import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type { AuthAction } from "../../../core/tenant/rbac.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import { renderIntegrationsPage } from "../../web/integrations-page.js";
import {
  ecosystemEventSchema,
  integrationTestBodySchema,
  integrationsResponseSchemas,
  integrationsStatusResponseSchema,
} from "./integrations-schema.js";

export interface IntegrationsRuntime {
  limiter: ProtectedUsersLimiter;
  service: EcosystemAdaptersService;
}

export function registerIntegrationsRoutes(
  app: FastifyInstance,
  runtime: IntegrationsRuntime,
): void {
  registerIntegrationPages(app, runtime);

  app.get(
    "/api/integrations/status",
    {
      preHandler: boundary(
        app,
        runtime,
        "GET",
        "/api/integrations/status",
        "ecosystem_adapters.configure",
      ),
      schema: {
        response: { 200: integrationsStatusResponseSchema, ...integrationsResponseSchemas },
      },
    },
    async () => ({ integrations: runtime.service.statuses() }),
  );

  app.post<{ Body: { target_system: EcosystemTarget } }>(
    "/api/integrations/test-event",
    {
      preHandler: boundary(
        app,
        runtime,
        "POST",
        "/api/integrations/test-event",
        "ecosystem_adapters.configure",
      ),
      schema: {
        body: integrationTestBodySchema,
        response: { 201: ecosystemEventSchema, ...integrationsResponseSchemas },
      },
    },
    async (request, reply) => {
      const context = userContext(request.authContext);
      const event = await runtime.service.testEvent(context.tenantId, request.body.target_system);
      return reply.code(201).send(publicEvent(event));
    },
  );
}

function registerIntegrationPages(app: FastifyInstance, runtime: IntegrationsRuntime): void {
  registerFormParser(app);
  app.get(
    "/integrations",
    {
      preHandler: boundary(
        app,
        runtime,
        "GET",
        "/api/integrations/status",
        "ecosystem_adapters.configure",
      ),
    },
    async (request, reply) => {
      const user = userContext(request.authContext);
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(
          renderIntegrationsPage({
            integrations: runtime.service.statuses(),
            role: user.role,
            csrfToken: browserCsrfCookie(request.cookies),
          }),
        );
    },
  );

  app.post<{ Body: unknown }>(
    "/integrations/test-event",
    {
      bodyLimit: 8 * 1024,
      preHandler: boundary(
        app,
        runtime,
        "POST",
        "/api/integrations/test-event",
        "ecosystem_adapters.configure",
      ),
    },
    async (request, reply) => {
      const user = userContext(request.authContext);
      await runtime.service.testEvent(user.tenantId, parseIntegrationForm(request.body));
      return reply.code(303).header("location", "/integrations").send("");
    },
  );
}

function registerFormParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser("application/x-www-form-urlencoded")) return;
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 8 * 1024 },
    (_request, body, done) => done(null, parseFormBody(body)),
  );
}

function parseFormBody(body: string | Buffer): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(
    Buffer.isBuffer(body) ? body.toString("utf8") : body,
  )) {
    result[key] = value;
  }
  return result;
}

function parseIntegrationForm(body: unknown): EcosystemTarget {
  const target =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { target_system?: unknown }).target_system
      : undefined;
  if (
    target !== "notification_hub" &&
    target !== "workflow_engine" &&
    target !== "invoice_reconciliation_engine"
  ) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "The integration target is invalid.",
      statusCode: 400,
      details: [],
    });
  }
  return target;
}

function browserCsrfCookie(
  cookies: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return cookies.ccpo_csrf ?? cookies["__Host-ccpo_csrf"];
}

function boundary(
  app: FastifyInstance,
  runtime: IntegrationsRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  action: AuthAction,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction(action),
    async (request, reply) => {
      const decision = await runtime.limiter.admit(userContext(request.authContext), method, route);
      if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds);
    },
  ];
}

function userContext(value: unknown): RequestContext & { actorType: "user" } {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { actorType?: unknown }).actorType !== "user"
  ) {
    throw authError("FORBIDDEN");
  }
  return value as RequestContext & { actorType: "user" };
}

function publicEvent(event: Awaited<ReturnType<EcosystemAdaptersService["testEvent"]>>) {
  return {
    id: event.id,
    event_type: event.eventType,
    event_id: event.eventId,
    status: event.status,
    target_system: event.targetSystem,
    next_attempt_at: event.nextAttemptAt,
    attempt_count: event.attemptCount,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
  };
}

function rateLimited(reply: FastifyReply, retryAfterSeconds = 1): FastifyReply {
  reply.header("retry-after", String(Math.max(1, retryAfterSeconds)));
  return reply.code(429).send(
    toErrorEnvelope(
      new AppError({
        code: "RATE_LIMITED",
        message: "Too many integration requests.",
        statusCode: 429,
      }),
    ),
  );
}
