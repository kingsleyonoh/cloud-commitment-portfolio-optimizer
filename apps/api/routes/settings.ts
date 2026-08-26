import type { FastifyInstance, FastifyReply } from "fastify";

import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type { ApiKeyMetadataService } from "../../../core/tenant/api-key-metadata-service.js";
import type { TenantProfileService } from "../../../core/tenant/profile-service.js";
import type { ProtectedUsersLimiter } from "../../../core/tenant/protected-users-limiter.js";
import type { UserRequestContext } from "../../../core/tenant/request-context.js";
import type { UsersService } from "../../../core/tenant/users-service.js";
import { renderSettingsPage } from "../../web/settings-page.js";

export interface SettingsRuntime {
  apiKeys: ApiKeyMetadataService;
  limiter: ProtectedUsersLimiter;
  tenantProfile: TenantProfileService;
  users: UsersService;
}

export function registerSettingsRoute(app: FastifyInstance, runtime: SettingsRuntime): void {
  app.get(
    "/settings",
    {
      preHandler: [
        app.authenticate,
        app.requireAction("tenant_profile.read"),
        app.requireAction("users.read_manage"),
        app.requireAction("api_keys.read_manage"),
        async (request, reply) => {
          const context = userContext(request.authContext);
          const decision = await runtime.limiter.admit(context, "GET", "/api/users");
          if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds);
        },
      ],
    },
    async (request, reply) => {
      const context = userContext(request.authContext);
      const [profile, users, apiKeys] = await Promise.all([
        runtime.tenantProfile.getCurrent(context.tenantId),
        runtime.users.list(context, { limit: "100" }),
        runtime.apiKeys.list(context, { limit: "100" }),
      ]);
      return reply
        .code(200)
        .type("text/html; charset=utf-8")
        .send(
          renderSettingsPage({
            profile,
            users: users.users,
            apiKeys: apiKeys.api_keys,
          }),
        );
    },
  );
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

function rateLimited(reply: FastifyReply, retryAfterSeconds = 1): FastifyReply {
  reply.header("retry-after", String(Math.max(1, retryAfterSeconds)));
  const error = new AppError({
    code: "RATE_LIMITED",
    message: "Too many settings requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
