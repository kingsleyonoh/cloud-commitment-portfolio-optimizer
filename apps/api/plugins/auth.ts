import { randomUUID, type KeyObject } from "node:crypto";
import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";

import { createAuthenticationService } from "../../../core/tenant/auth-service.js";
import type { ArgonExecutor } from "../../../core/tenant/argon-executor.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type { AuthLoginRepository } from "../../../core/tenant/auth-login-repository.js";
import type { AuthLogoutRepository } from "../../../core/tenant/auth-logout-repository.js";
import type { AuthRefreshRepository } from "../../../core/tenant/auth-refresh-repository.js";
import type { AuthRepository } from "../../../core/tenant/auth-repository.js";
import { createSessionCookiePolicy } from "../../../core/tenant/auth-session-cookie.js";
import { assertCanonicalCookie } from "../../../core/tenant/auth-session-csrf.js";
import type { AuthSessionLimiter } from "../../../core/tenant/auth-session-limiter.js";
import { createAuthSessionService } from "../../../core/tenant/auth-session-service.js";
import type { AccessSigner, SessionCookiePolicy } from "../../../core/tenant/auth-session-types.js";
import { canPerformAuthAction, type AuthAction } from "../../../core/tenant/rbac.js";
import { selectRequestCredential } from "../../../core/tenant/request-credential.js";
import type { JwtClaimPolicy } from "../../../core/tenant/jwt-validation.js";
import { registerAuthSessionRoutes } from "../routes/auth-session.js";

export interface AuthenticationRuntime {
  repository: AuthRepository;
  jwtPublicKey: KeyObject | null;
  jwtPrivateKey?: KeyObject | null;
  jwtPolicy: JwtClaimPolicy;
  cookiePolicy?: SessionCookiePolicy;
  sessions?: {
    loginRepository: AuthLoginRepository;
    refreshRepository: AuthRefreshRepository;
    logoutRepository: AuthLogoutRepository;
    limiter: AuthSessionLimiter;
    argonExecutor: ArgonExecutor;
    dummyPasswordHash: string;
    trustedProxyCidrs: readonly string[];
  };
}

export interface AuthPluginOptions extends AuthenticationRuntime {
  protectedRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  app.decorateRequest("authContext", null);
  await app.register(fastifyCookie, { hook: "onRequest" });
  await registerJwt(app, options);
  const policy = resolveCookiePolicy(options);
  decorateAuthentication(app, options, policy);
  decorateAuthorization(app);
  registerSessions(app, options, policy);
  await options.protectedRoutes?.(app);
};

async function registerJwt(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  if (!options.jwtPublicKey) return;
  const publicKey = options.jwtPublicKey.export({ type: "spki", format: "pem" });
  const privateKey = options.jwtPrivateKey?.export({ type: "pkcs8", format: "pem" });
  await app.register(fastifyJwt, {
    secret: privateKey ? { public: publicKey, private: privateKey } : { public: publicKey },
    decode: { checkTyp: "JWT" },
    sign: { algorithm: "RS256" },
    verify: {
      algorithms: ["RS256"],
      allowedIss: options.jwtPolicy.issuer,
      allowedAud: options.jwtPolicy.audience,
      clockTolerance: options.jwtPolicy.clockToleranceSeconds,
      requiredClaims: ["iss", "aud", "sub", "tenant_id", "role", "jti", "iat", "exp"],
    },
  });
}

function resolveCookiePolicy(options: AuthPluginOptions): SessionCookiePolicy {
  return (
    options.cookiePolicy ??
    createSessionCookiePolicy({
      secure: false,
      publicBaseUrl: "http://localhost:8080",
      accessLifetimeSeconds: options.jwtPolicy.maxLifetimeSeconds,
    })
  );
}

function decorateAuthentication(
  app: FastifyInstance,
  options: AuthPluginOptions,
  policy: SessionCookiePolicy,
): void {
  const authentication = createAuthenticationService({
    repository: options.repository,
    jwtPolicy: options.jwtPolicy,
    verifyJwt: options.jwtPublicKey
      ? (token) => app.jwt.verify(token)
      : () => {
          throw authError("AUTH_INVALID");
        },
  });
  app.decorate("authenticate", async (request) => {
    const rawCookie =
      typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
    const access = assertCanonicalCookie(
      rawCookie,
      policy.accessName,
      request.cookies[policy.accessName],
      "AUTH_INVALID",
    );
    const credential = selectRequestCredential(request.headers, access);
    const csrf = cookieCsrf(request.cookies, rawCookie, policy, credential.kind);
    request.authContext = await authentication.authenticate(credential, request.id, {
      method: request.method,
      headers: request.headers,
      csrfCookie: csrf,
      expectedOrigin: policy.publicOrigin,
    });
  });
}

function cookieCsrf(
  cookies: Readonly<Record<string, string | undefined>>,
  rawCookie: string | undefined,
  policy: SessionCookiePolicy,
  credentialKind: "api_key" | "jwt" | "access_cookie",
): string | undefined {
  if (credentialKind !== "access_cookie") return undefined;
  return assertCanonicalCookie(
    rawCookie,
    policy.csrfName,
    cookies[policy.csrfName],
    "CSRF_INVALID",
  );
}

function decorateAuthorization(app: FastifyInstance): void {
  app.decorate("requireAction", (action: AuthAction): preHandlerHookHandler => {
    return async (request) => {
      const context = request.authContext;
      if (!context) throw authError("AUTH_REQUIRED");
      if (!canPerformAuthAction(context.role, action, context.actorType)) {
        throw authError("FORBIDDEN");
      }
    };
  });
}

function registerSessions(
  app: FastifyInstance,
  options: AuthPluginOptions,
  cookiePolicy: SessionCookiePolicy,
): void {
  if (!options.sessions || !options.jwtPrivateKey) return;
  const service = createAuthSessionService({
    ...options.sessions,
    accessLifetimeSeconds: options.jwtPolicy.maxLifetimeSeconds,
    sign: accessSigner(app, options.jwtPolicy),
  });
  registerAuthSessionRoutes(app, {
    service,
    cookiePolicy,
    trustedProxyCidrs: options.sessions.trustedProxyCidrs,
  });
  app.addHook("onClose", async () => {
    options.sessions!.argonExecutor.close();
    await options.sessions!.limiter.close();
  });
}

function accessSigner(app: FastifyInstance, policy: JwtClaimPolicy): AccessSigner {
  return (claims) =>
    app.jwt.sign({
      iss: policy.issuer,
      aud: policy.audience,
      sub: claims.userId,
      tenant_id: claims.tenantId,
      role: claims.role,
      jti: randomUUID(),
      iat: claims.issuedAt,
      exp: claims.expiresAt,
      sid: claims.familyId,
      csrf_hash: claims.csrfHash,
    });
}
