import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";

import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type {
  ProtectedUsersLimiter,
  ProtectedUsersMethod,
  ProtectedUsersRoute,
} from "../../../core/tenant/protected-users-limiter.js";
import type { UserRequestContext } from "../../../core/tenant/request-context.js";
import type { UserPasswordService } from "../../../core/tenant/user-password-service.js";
import type { UsersService } from "../../../core/tenant/users-service.js";
import {
  tenantUserSchema,
  userCreateBodySchema,
  userPasswordBodySchema,
  userPasswordPathSchema,
  userPasswordResponseSchemas,
  userPatchBodySchema,
  userPathSchema,
  usersListQuerySchema,
  usersListResponseSchema,
  usersResponseSchemas,
} from "./users-schema.js";

export interface UsersRuntime {
  limiter: ProtectedUsersLimiter;
  service: UsersService;
  passwordService?: UserPasswordService;
  closePasswordExecutor?: () => void;
}

export function registerUsersRoutes(app: FastifyInstance, runtime: UsersRuntime): void {
  app.addHook("onClose", async () => {
    runtime.closePasswordExecutor?.();
    await runtime.limiter.close?.();
  });
  registerListRoute(app, runtime);
  registerCreateRoute(app, runtime);
  registerPatchRoute(app, runtime);
  if (runtime.passwordService) registerPasswordRoute(app, runtime, runtime.passwordService);
}

function registerListRoute(app: FastifyInstance, runtime: UsersRuntime): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/users",
    {
      preHandler: protectedBoundary(app, runtime, "GET", "/api/users"),
      schema: {
        querystring: usersListQuerySchema,
        response: { 200: usersListResponseSchema, ...usersResponseSchemas },
      },
    },
    async (request) => runtime.service.list(userContext(request.authContext), request.query),
  );
}

function registerCreateRoute(app: FastifyInstance, runtime: UsersRuntime): void {
  app.post<{ Body: unknown }>(
    "/api/users",
    {
      preHandler: protectedBoundary(app, runtime, "POST", "/api/users"),
      schema: {
        body: userCreateBodySchema,
        response: { 201: tenantUserSchema, ...usersResponseSchemas },
      },
    },
    async (request, reply) => {
      const user = await runtime.service.create(userContext(request.authContext), request.body);
      return reply.code(201).send(user);
    },
  );
}

function registerPatchRoute(app: FastifyInstance, runtime: UsersRuntime): void {
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/users/:id",
    {
      preHandler: protectedBoundary(app, runtime, "PATCH", "/api/users/{id}"),
      schema: {
        params: userPathSchema,
        body: userPatchBodySchema,
        response: { 200: tenantUserSchema, ...usersResponseSchemas },
      },
    },
    async (request) =>
      runtime.service.patch(userContext(request.authContext), request.params.id, request.body),
  );
}

function registerPasswordRoute(
  app: FastifyInstance,
  runtime: UsersRuntime,
  passwordService: UserPasswordService,
): void {
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/users/:id/credentials/password",
    {
      bodyLimit: 2048,
      preHandler: protectedBoundary(
        app,
        runtime,
        "PUT",
        "/api/users/{id}/credentials/password",
        true,
      ),
      schema: {
        params: userPasswordPathSchema,
        body: userPasswordBodySchema,
        response: userPasswordResponseSchemas,
      },
    },
    async (request, reply) => {
      await passwordService.setPassword(
        userContext(request.authContext),
        request.params.id,
        request.body,
      );
      return reply.code(204).send();
    },
  );
}

function protectedBoundary(
  app: FastifyInstance,
  runtime: UsersRuntime,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  targetScoped = false,
): preHandlerHookHandler[] {
  return [
    app.authenticate,
    app.requireAction("users.read_manage"),
    async (request, reply) => {
      const context = userContext(request.authContext);
      let decision;
      try {
        const target = targetScoped ? (request.params as { id?: unknown }).id : undefined;
        decision = await runtime.limiter.admit(
          context,
          method,
          route,
          typeof target === "string" ? target : undefined,
        );
      } catch (error) {
        if (route === "/api/users/{id}/credentials/password") {
          throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
        }
        throw error;
      }
      if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds, route);
    },
  ];
}

function userContext(context: unknown): UserRequestContext {
  if (
    !context ||
    typeof context !== "object" ||
    (context as { actorType?: unknown }).actorType !== "user"
  ) {
    throw authError("FORBIDDEN");
  }
  return context as UserRequestContext;
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
      route === "/api/users/{id}/credentials/password"
        ? "Too many password credential requests."
        : "Too many user management requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
