import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import type { ApprovalsService } from "../../../core/approvals/approvals-service.js";
import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { AuthAction } from "../../../core/tenant/rbac.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import { renderApprovalDetailPage, renderApprovalsPage } from "../../web/approvals-page.js";
import {
  approvalDecisionBodySchema,
  approvalDetailSchema,
  approvalPathSchema,
  approvalRequestBodySchema,
  approvalSchema,
  approvalsListQuerySchema,
  approvalsListResponseSchema,
  approvalsResponseSchemas,
} from "./approvals-schema.js";

export interface ApprovalsRuntime {
  limiter: ProtectedUsersLimiter;
  service: ApprovalsService;
}

export function registerApprovalsRoutes(app: FastifyInstance, runtime: ApprovalsRuntime): void {
  registerApprovalPages(app, runtime);

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/recommendations/:id/request-approval",
    {
      preHandler: protectedBoundary(
        app,
        runtime,
        "POST",
        "/api/recommendations/{id}/request-approval",
        "recommendations.request_approval",
      ),
      schema: {
        params: approvalPathSchema,
        body: approvalRequestBodySchema,
        response: { 201: approvalSchema, ...approvalsResponseSchemas },
      },
    },
    async (request, reply) => {
      const approval = await runtime.service.requestApproval(
        requestContext(request.authContext),
        request.params.id,
        request.body,
      );
      return reply.code(201).send(approval);
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/approvals",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/approvals", "approvals.read"),
      schema: {
        querystring: approvalsListQuerySchema,
        response: { 200: approvalsListResponseSchema, ...approvalsResponseSchemas },
      },
    },
    async (request) => runtime.service.list(requestContext(request.authContext), request.query),
  );

  app.get<{ Params: { id: string } }>(
    "/api/approvals/:id",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/approvals/{id}", "approvals.read"),
      schema: {
        params: approvalPathSchema,
        response: { 200: approvalDetailSchema, ...approvalsResponseSchemas },
      },
    },
    async (request) => runtime.service.get(requestContext(request.authContext), request.params.id),
  );

  for (const decision of ["approve", "reject"] as const) {
    app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
      `/api/approvals/:id/${decision}`,
      {
        preHandler: protectedBoundary(
          app,
          runtime,
          "POST",
          `/api/approvals/{id}/${decision}`,
          "recommendations.approve_reject",
        ),
        schema: {
          params: approvalPathSchema,
          body: approvalDecisionBodySchema,
          response: { 200: approvalDetailSchema, ...approvalsResponseSchemas },
        },
      },
      async (request) =>
        decision === "approve"
          ? runtime.service.approve(
              requestContext(request.authContext),
              request.params.id,
              request.body,
            )
          : runtime.service.reject(
              requestContext(request.authContext),
              request.params.id,
              request.body,
            ),
    );
  }
}

function registerApprovalPages(app: FastifyInstance, runtime: ApprovalsRuntime): void {
  registerFormParser(app);

  app.get(
    "/approvals",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/approvals", "approvals.read"),
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const page = await runtime.service.list(context, { limit: "100" });
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(renderApprovalsPage({ approvals: page.approvals, role: context.role }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/approvals/:id",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/approvals/{id}", "approvals.read"),
      schema: { params: approvalPathSchema },
    },
    async (request, reply) => {
      const context = requestContext(request.authContext);
      const detail = await runtime.service.get(context, request.params.id);
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(
          renderApprovalDetailPage({
            detail,
            role: context.role,
            csrfToken: browserCsrfCookie(request.cookies),
          }),
        );
    },
  );

  for (const decision of ["approve", "reject"] as const) {
    app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
      `/approvals/:id/${decision}`,
      {
        bodyLimit: 8 * 1024,
        preHandler: protectedBoundary(
          app,
          runtime,
          "POST",
          `/api/approvals/{id}/${decision}`,
          "recommendations.approve_reject",
        ),
        schema: { params: approvalPathSchema },
      },
      async (request, reply) => {
        const context = requestContext(request.authContext);
        const decisionBody = { ...(request.body ?? {}) };
        delete decisionBody._csrf;
        if (decision === "approve") {
          await runtime.service.approve(context, request.params.id, decisionBody);
        } else {
          await runtime.service.reject(context, request.params.id, decisionBody);
        }
        return reply.code(303).header("location", "/approvals").send("");
      },
    );
  }
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
  const raw = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  const parsed = new URLSearchParams(raw);
  const result: Record<string, unknown> = {};
  for (const [key, value] of parsed) {
    if (Object.hasOwn(result, key)) {
      result[key] = [result[key], value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function browserCsrfCookie(
  cookies: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return cookies.ccpo_csrf ?? cookies["__Host-ccpo_csrf"];
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: ApprovalsRuntime,
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
    message: "Too many approval requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
