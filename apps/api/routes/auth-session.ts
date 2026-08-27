import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../../core/shared/errors.js";
import { renderLoginPage } from "../../web/login-page.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import { resolveAuthClientIp } from "../../../core/tenant/auth-client-ip.js";
import {
  assertCanonicalCookie,
  assertDoubleSubmit,
  assertSameOrigin,
} from "../../../core/tenant/auth-session-csrf.js";
import {
  clearSessionCookies,
  setSessionCookies,
} from "../../../core/tenant/auth-session-cookie.js";
import { isCanonicalOpaqueSecret } from "../../../core/tenant/auth-session-crypto.js";
import {
  AuthRateLimitError,
  type AuthSessionService,
} from "../../../core/tenant/auth-session-service.js";
import type { SessionCookiePolicy } from "../../../core/tenant/auth-session-types.js";
import { parseLoginInput } from "../../../core/tenant/auth-login-input.js";
import {
  authLoginBodySchema,
  authLoginResponses,
  authLogoutResponses,
  authRefreshResponses,
} from "./auth-session-schema.js";

export interface AuthSessionRouteRuntime {
  service: AuthSessionService;
  cookiePolicy: SessionCookiePolicy;
  trustedProxyCidrs: readonly string[];
}

export function registerAuthSessionRoutes(
  app: FastifyInstance,
  runtime: AuthSessionRouteRuntime,
): void {
  registerFormParser(app);
  registerLoginPage(app, runtime);
  registerLogin(app, runtime);
  registerRefresh(app, runtime);
  registerLogout(app, runtime);
}

function registerFormParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 4096 },
    (_request, body, done) => done(null, parseFormBody(body)),
  );
}

function registerLoginPage(app: FastifyInstance, runtime: AuthSessionRouteRuntime): void {
  app.get("/login", async (_request, reply) =>
    reply.code(200).type("text/html; charset=utf-8").send(renderLoginPage()),
  );
  app.post<{ Body: unknown }>("/login", { bodyLimit: 4096 }, async (request, reply) => {
    rejectCredentialHeaders(request);
    assertFormMedia(request.headers["content-type"]);
    assertSameOrigin(request.headers, runtime.cookiePolicy.publicOrigin);
    const body = parseLoginInput(request.body);
    try {
      const issue = await withRateHeader(reply, () =>
        runtime.service.login({
          ...body,
          clientIp: clientIp(request, runtime.trustedProxyCidrs),
          requestId: request.id,
        }),
      );
      setSessionCookies(reply, runtime.cookiePolicy, issue);
      return reply.code(303).header("location", "/dashboard").send("");
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        return reply
          .code(error.statusCode)
          .type("text/html; charset=utf-8")
          .send(
            renderLoginPage({
              error,
              values: { tenantId: body.tenantId, email: body.email },
            }),
          );
      }
      throw error;
    }
  });
}

function registerLogin(app: FastifyInstance, runtime: AuthSessionRouteRuntime): void {
  app.post<{ Body: unknown }>(
    "/api/auth/login",
    {
      bodyLimit: 4096,
      schema: { body: authLoginBodySchema, response: authLoginResponses },
    },
    async (request, reply) => {
      rejectCredentialHeaders(request);
      assertLoginMedia(request.headers["content-type"]);
      assertSameOrigin(request.headers, runtime.cookiePolicy.publicOrigin);
      const body = parseLoginInput(request.body);
      const issue = await withRateHeader(reply, () =>
        runtime.service.login({
          ...body,
          clientIp: clientIp(request, runtime.trustedProxyCidrs),
          requestId: request.id,
        }),
      );
      setSessionCookies(reply, runtime.cookiePolicy, issue);
      return reply.code(200).send({ session: issue.session });
    },
  );
}

function registerRefresh(app: FastifyInstance, runtime: AuthSessionRouteRuntime): void {
  app.post<{ Body: unknown }>(
    "/api/auth/refresh",
    { bodyLimit: 1024, schema: { response: authRefreshResponses } },
    async (request, reply) => {
      rejectCredentialHeaders(request);
      assertNoBody(request.body);
      const refresh = sessionCookie(request, runtime.cookiePolicy.refreshName, "AUTH_INVALID");
      if (refresh === undefined) throw authError("AUTH_REQUIRED");
      assertSameOrigin(request.headers, runtime.cookiePolicy.publicOrigin);
      const csrf = assertDoubleSubmit(
        request.headers,
        sessionCookie(request, runtime.cookiePolicy.csrfName, "CSRF_INVALID"),
      );
      try {
        const issue = await withRateHeader(reply, () =>
          runtime.service.refresh({
            refreshToken: refresh,
            csrfToken: csrf,
            clientIp: clientIp(request, runtime.trustedProxyCidrs),
            requestId: request.id,
          }),
        );
        setSessionCookies(reply, runtime.cookiePolicy, issue);
        return reply.code(200).send({ session: issue.session });
      } catch (error) {
        if (shouldClearRefreshFailure(error)) clearSessionCookies(reply, runtime.cookiePolicy);
        throw error;
      }
    },
  );
}

function registerLogout(app: FastifyInstance, runtime: AuthSessionRouteRuntime): void {
  app.post<{ Body: unknown }>(
    "/api/auth/logout",
    { bodyLimit: 1024, schema: { response: authLogoutResponses } },
    async (request, reply) => {
      rejectCredentialHeaders(request);
      assertNoBody(request.body);
      const refresh = sessionCookie(request, runtime.cookiePolicy.refreshName, "AUTH_INVALID");
      if (refresh !== undefined) {
        assertSameOrigin(request.headers, runtime.cookiePolicy.publicOrigin);
        const csrf = assertDoubleSubmit(
          request.headers,
          sessionCookie(request, runtime.cookiePolicy.csrfName, "CSRF_INVALID"),
        );
        if (isCanonicalOpaqueSecret(refresh)) {
          await runtime.service.logout({
            refreshToken: refresh,
            csrfToken: csrf,
            requestId: request.id,
          });
        }
      }
      clearSessionCookies(reply, runtime.cookiePolicy);
      return reply.code(204).send();
    },
  );
}

function sessionCookie(
  request: FastifyRequest,
  name: string,
  code: "AUTH_INVALID" | "CSRF_INVALID",
): string | undefined {
  return assertCanonicalCookie(
    typeof request.headers.cookie === "string" ? request.headers.cookie : undefined,
    name,
    request.cookies[name],
    code,
  );
}

function rejectCredentialHeaders(request: FastifyRequest): void {
  if (request.headers.authorization !== undefined || request.headers["x-api-key"] !== undefined) {
    throw authError("AUTH_CREDENTIAL_CONFLICT");
  }
}

function assertLoginMedia(contentType: string | undefined): void {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType ?? "")) {
    throw validationError();
  }
}

function assertFormMedia(contentType: string | undefined): void {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(contentType ?? "")) {
    throw validationError();
  }
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

function assertNoBody(body: unknown): void {
  if (body !== undefined) throw validationError();
}

function clientIp(request: FastifyRequest, cidrs: readonly string[]): string {
  return resolveAuthClientIp({
    socketPeer: request.raw.socket.remoteAddress,
    forwardedFor: request.headers["x-forwarded-for"],
    trustedProxyCidrs: cidrs,
  });
}

async function withRateHeader<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      reply.header("retry-after", String(error.retryAfterSeconds));
    }
    throw error;
  }
}

function shouldClearRefreshFailure(error: unknown): boolean {
  return (
    error instanceof AppError &&
    ["AUTH_INVALID", "USER_INACTIVE", "TENANT_INACTIVE"].includes(error.code)
  );
}

function validationError(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Session request is invalid.",
    statusCode: 400,
    details: [],
  });
}
