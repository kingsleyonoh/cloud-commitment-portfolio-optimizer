import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { ScenariosService } from "../../../core/scenarios/scenarios-service.js";
import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { AuthAction } from "../../../core/tenant/rbac.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import { renderScenarioDetailPage, renderScenariosPage } from "../../web/scenarios-page.js";
import {
  scenarioCreateBodySchema,
  scenarioPathSchema,
  scenarioSchema,
  scenariosListQuerySchema,
  scenariosListResponseSchema,
  scenariosResponseSchemas,
} from "./scenarios-schema.js";

export interface ScenariosRuntime {
  limiter: ProtectedUsersLimiter;
  service: ScenariosService;
}

export function registerScenariosRoutes(app: FastifyInstance, runtime: ScenariosRuntime): void {
  registerScenarioPages(app, runtime);

  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/scenarios",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/scenarios", "scenarios.read_write"),
      schema: {
        querystring: scenariosListQuerySchema,
        response: { 200: scenariosListResponseSchema, ...scenariosResponseSchemas },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );

  app.post<{ Body: unknown }>(
    "/api/scenarios",
    {
      bodyLimit: 1024 * 1024,
      preHandler: scenarioMutationBoundary(app, runtime, "POST", "/api/scenarios"),
      schema: {
        body: scenarioCreateBodySchema,
        response: { 201: scenarioSchema, ...scenariosResponseSchemas },
      },
    },
    async (request, reply) => {
      const scenario = await runtime.service.create(
        requestContext(request.authContext),
        request.body,
      );
      return reply.code(201).send(scenario);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/scenarios/:id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/scenarios/{id}",
        "scenarios.read_write",
      ),
      schema: {
        params: scenarioPathSchema,
        response: { 200: scenarioSchema, ...scenariosResponseSchemas },
      },
    },
    async (request) => runtime.service.get(requestContext(request.authContext), request.params.id),
  );
}

function registerScenarioPages(app: FastifyInstance, runtime: ScenariosRuntime): void {
  registerFormParser(app);
  app.get(
    "/scenarios",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/scenarios", "scenarios.read_write"),
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const page = await runtime.service.list(context, { limit: "100" });
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(
          renderScenariosPage({
            scenarios: page.scenarios,
            role: context.role,
            csrfToken: browserCsrfCookie(request.cookies),
          }),
        );
    },
  );

  app.post<{ Body: unknown }>(
    "/scenarios",
    {
      bodyLimit: 32 * 1024,
      preHandler: scenarioMutationBoundary(app, runtime, "POST", "/api/scenarios"),
    },
    async (request, reply) => {
      await runtime.service.create(
        requestContext(request.authContext),
        parseScenarioForm(request.body),
      );
      return reply.code(303).header("location", "/scenarios").send("");
    },
  );

  app.get<{ Params: { id: string } }>(
    "/scenarios/:id",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "GET",
        "/api/scenarios/{id}",
        "scenarios.read_write",
      ),
      schema: { params: scenarioPathSchema },
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const scenario = await runtime.service.get(context, request.params.id);
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(renderScenarioDetailPage({ scenario, role: context.role }));
    },
  );
}

function scenarioMutationBoundary(
  app: FastifyInstance,
  runtime: ScenariosRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
): preHandlerHookHandler[] {
  return [
    ...protectedBoundary(app, runtime, method, route, "scenarios.read_write"),
    async (request, reply) => {
      const context = requestContext(request.authContext);
      if (
        context.actorType !== "user" ||
        (context.role !== "tenant_admin" && context.role !== "finops_analyst")
      ) {
        return reply.code(403).send(toErrorEnvelope(authError("FORBIDDEN")));
      }
    },
  ];
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
    result[key] = value;
  }
  return result;
}

function parseScenarioForm(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return body as Record<string, unknown>;
  const object = body as Record<string, unknown>;
  const shockText = object.shock_config;
  let shockConfig: unknown = shockText;
  if (typeof shockText === "string") {
    try {
      shockConfig = JSON.parse(shockText);
    } catch {
      shockConfig = shockText;
    }
  }
  return {
    name: object.name,
    ...(typeof object.description === "string" && object.description.trim()
      ? { description: object.description }
      : {}),
    ...(typeof object.base_forecast_run_id === "string" && object.base_forecast_run_id.trim()
      ? { base_forecast_run_id: object.base_forecast_run_id }
      : {}),
    shock_config: shockConfig,
  };
}

function browserCsrfCookie(
  cookies: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return cookies.ccpo_csrf ?? cookies["__Host-ccpo_csrf"];
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: ScenariosRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  action: AuthAction,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction(action),
    async (request, reply) => {
      const context = requestContext(request.authContext);
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
  return reply.code(429).send(
    toErrorEnvelope(
      new AppError({
        code: "RATE_LIMITED",
        message: "Too many scenario requests.",
        statusCode: 429,
        details: [],
      }),
    ),
  );
}
