import type { FastifyInstance, FastifyReply } from "fastify";

import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import type { ApiKeyMetadataService } from "../../../core/tenant/api-key-metadata-service.js";
import type { ProtectedUsersLimiter } from "../../../core/tenant/protected-users-limiter.js";
import type { UserRequestContext } from "../../../core/tenant/request-context.js";
import {
  apiKeyMetadataListQuerySchema,
  apiKeyMetadataListResponseSchema,
  apiKeyMetadataResponseSchemas,
} from "./api-key-metadata-schema.js";

export interface ApiKeyMetadataRuntime {
  limiter: ProtectedUsersLimiter;
  service: ApiKeyMetadataService;
}

export function registerApiKeyMetadataRoute(
  app: FastifyInstance,
  runtime: ApiKeyMetadataRuntime,
): void {
  app.addHook("onClose", async () => runtime.limiter.close?.());
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/api-keys",
    {
      preHandler: [
        app.authenticate,
        app.requireAction("api_keys.read_manage"),
        async (request, reply) => {
          const context = userContext(request.authContext);
          const decision = await runtime.limiter.admit(context, "GET", "/api/api-keys");
          if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds);
        },
      ],
      schema: {
        querystring: apiKeyMetadataListQuerySchema,
        response: { 200: apiKeyMetadataListResponseSchema, ...apiKeyMetadataResponseSchemas },
      },
    },
    async (request) => runtime.service.list(userContext(request.authContext), request.query),
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
    message: "Too many API-key metadata requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
