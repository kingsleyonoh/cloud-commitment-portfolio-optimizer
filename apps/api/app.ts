import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from "fastify";
import { renderErrorPage } from "../web/error-page.js";
import { AppError, normalizeError, toErrorEnvelope } from "../../core/shared/errors.js";
import type { Logger } from "../../core/shared/logger.js";
import { authPlugin, type AuthenticationRuntime } from "./plugins/auth.js";
import {
  registerApiKeyMetadataRoute,
  type ApiKeyMetadataRuntime,
} from "./routes/api-key-metadata.js";
import {
  registerApiKeyRotationRoute,
  type ApiKeyRotationRuntime,
} from "./routes/api-key-rotation.js";
import { registerHealthRoutes, type DatabaseProbe } from "./routes/health.js";
import {
  registerTenantRegistrationRoute,
  type TenantRegistrationRuntime,
} from "./routes/tenant-registration.js";
import { registerTenantProfileRoute, type TenantProfileRuntime } from "./routes/tenant-profile.js";
import { registerUsersRoutes, type UsersRuntime } from "./routes/users.js";

export interface BuildAppOptions {
  logger: Logger;
  databaseProbe: DatabaseProbe;
  databaseTimeoutMs: number;
  genReqId?: () => string;
  authentication?: AuthenticationRuntime;
  protectedRoutes?: (app: FastifyInstance) => void | Promise<void>;
  tenantRegistration?: TenantRegistrationRuntime;
  tenantProfile?: TenantProfileRuntime;
  users?: UsersRuntime;
  apiKeys?: ApiKeyMetadataRuntime;
  apiKeyRotation?: ApiKeyRotationRuntime;
  registrationTrustedProxyCidrs?: string[];
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = createFastify(options);
  registerRequestLifecycle(app, options.logger);
  registerApplicationRoutes(app, options);
  registerNotFoundHandler(app);
  registerErrorHandler(app, options.logger);
  return app;
}

function createFastify(options: BuildAppOptions): FastifyInstance {
  return Fastify({
    genReqId: options.genReqId ?? (() => randomUUID()),
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy:
      options.registrationTrustedProxyCidrs && options.registrationTrustedProxyCidrs.length > 0
        ? options.registrationTrustedProxyCidrs
        : false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
        allErrors: false,
      },
    },
  });
}

function registerApplicationRoutes(app: FastifyInstance, options: BuildAppOptions): void {
  if (options.tenantRegistration) registerTenantRegistrationRoute(app, options.tenantRegistration);
  if (options.authentication) {
    void app.register(authPlugin, {
      ...options.authentication,
      protectedRoutes: async (instance) => {
        if (options.tenantProfile) registerTenantProfileRoute(instance, options.tenantProfile);
        if (options.users) registerUsersRoutes(instance, options.users);
        if (options.apiKeys) registerApiKeyMetadataRoute(instance, options.apiKeys);
        if (options.apiKeyRotation) registerApiKeyRotationRoute(instance, options.apiKeyRotation);
        await options.protectedRoutes?.(instance);
      },
    });
  }
  registerHealthRoutes(app, options);
}

function registerNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request, reply) => {
    const registrationDisabled =
      request.method === "POST" && request.url.split("?", 1)[0] === "/api/tenants/register";
    const error = new AppError({
      code: registrationDisabled ? "REGISTRATION_DISABLED" : "NOT_FOUND",
      message: registrationDisabled
        ? "Resource not found."
        : "The requested resource was not found.",
      statusCode: 404,
      details: registrationDisabled ? [] : [{ reference: request.id }],
    });
    if (prefersJson(request)) return reply.code(404).send(toErrorEnvelope(error));
    return reply
      .code(404)
      .type("text/html; charset=utf-8")
      .send(renderErrorPage({ kind: "not-found", reference: request.id }));
  });
}

function registerErrorHandler(app: FastifyInstance, logger: Logger): void {
  app.setErrorHandler(async (error, request, reply) => {
    const normalized = normalizeHttpError(error, request.id, request.routeOptions.url);
    if (normalized.code === "IDEMPOTENCY_IN_PROGRESS") reply.header("retry-after", "1");
    const attributes = {
      requestId: request.id,
      method: request.method,
      path: request.routeOptions.url ?? "unmatched",
      code: normalized.code,
      statusCode: normalized.statusCode,
    };
    if (normalized.statusCode >= 500) {
      await logger.error("http.request.failed", attributes);
    } else if (normalized.statusCode === 429) {
      await logger.warn("http.request.rejected", attributes);
    } else {
      await logger.info("http.request.rejected", attributes);
    }
    if (prefersJson(request)) {
      return reply.code(normalized.statusCode).send(toErrorEnvelope(normalized));
    }
    return reply
      .code(normalized.statusCode)
      .type("text/html; charset=utf-8")
      .send(renderErrorPage({ kind: "internal-error", reference: request.id }));
  });
}

type RequestKind = "registration" | "rotation" | "password" | "login" | "session" | "other";

function normalizeHttpError(error: unknown, requestId: string, route?: string): AppError {
  if (error instanceof AppError) return error;
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: string; statusCode?: number; validation?: unknown })
      : {};
  const kind = requestKind(route);
  if (candidate.code === "FST_ERR_CTP_BODY_TOO_LARGE") return payloadError(kind);
  const parser = typeof candidate.code === "string" && candidate.code.startsWith("FST_ERR_CTP_");
  const sessionMedia = ["login", "session"].includes(kind) && candidate.statusCode === 415;
  if (
    Array.isArray(candidate.validation) ||
    parser ||
    candidate.statusCode === 400 ||
    sessionMedia
  ) {
    return validationError(kind);
  }
  return normalizeError(error, { correlationId: requestId });
}

function requestKind(route?: string): RequestKind {
  if (route === "/api/tenants/register") return "registration";
  if (route === "/api/api-keys/rotate") return "rotation";
  if (route === "/api/users/{id}/credentials/password") return "password";
  if (route === "/api/auth/login") return "login";
  if (route === "/api/auth/refresh" || route === "/api/auth/logout") return "session";
  return "other";
}

function payloadError(kind: RequestKind): AppError {
  const messages: Record<RequestKind, string> = {
    registration: "Registration request exceeds 16384 bytes.",
    rotation: "API-key rotation request exceeds 16384 bytes.",
    password: "Password credential request exceeds 2048 bytes.",
    login: "Login request exceeds 4096 bytes.",
    session: "Session request exceeds 1024 bytes.",
    other: "Request exceeds the allowed size.",
  };
  return new AppError({ code: "PAYLOAD_TOO_LARGE", message: messages[kind], statusCode: 413 });
}

function validationError(kind: RequestKind): AppError {
  const messages: Record<RequestKind, string> = {
    registration: "Registration request is invalid.",
    rotation: "API-key rotation request is invalid.",
    password: "Password credential request is invalid.",
    login: "Session request is invalid.",
    session: "Session request is invalid.",
    other: "Request is invalid.",
  };
  return new AppError({ code: "VALIDATION_ERROR", message: messages[kind], statusCode: 400 });
}

function registerRequestLifecycle(app: FastifyInstance, logger: Logger): void {
  app.addHook("onRequest", async (request, reply) => {
    reply.headers({ ...SECURITY_HEADERS, "x-request-id": request.id });
    await logger.info("http.request.started", {
      requestId: request.id,
      method: request.method,
      path: request.routeOptions.url ?? "unmatched",
    });
  });
  app.addHook("onResponse", async (request, reply) => {
    await logger.info("http.request.completed", {
      requestId: request.id,
      method: request.method,
      path: request.routeOptions.url ?? "unmatched",
      statusCode: reply.statusCode,
    });
  });
}

function prefersJson(request: FastifyRequest): boolean {
  if (/^\/(?:api(?:\/|\?|$)|tenants\/me(?:\?|$))/u.test(request.url)) return true;
  const accept = request.headers.accept ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}
