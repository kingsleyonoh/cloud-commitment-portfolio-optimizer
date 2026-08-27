import type { FastifyInstance, FastifyReply } from "fastify";

import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { authError } from "../../../core/tenant/auth-errors.js";
import { parseApiKeyRotationBody } from "../../../core/tenant/api-key-rotation-input.js";
import type { ApiKeyRotationService } from "../../../core/tenant/api-key-rotation-service.js";
import type { ProtectedUsersLimiter } from "../../../core/tenant/protected-users-limiter.js";
import type { UserRequestContext } from "../../../core/tenant/request-context.js";
import {
  apiKeyRotationBodySchema,
  apiKeyRotationResponseSchema,
  apiKeyRotationResponseSchemas,
} from "./api-key-rotation-schema.js";

export interface ApiKeyRotationRuntime {
  limiter: ProtectedUsersLimiter;
  service: ApiKeyRotationService;
}

export function registerApiKeyRotationRoute(
  app: FastifyInstance,
  runtime: ApiKeyRotationRuntime,
): void {
  app.addHook("onClose", async () => runtime.limiter.close?.());
  app.post<{ Body: unknown }>(
    "/api/api-keys/rotate",
    {
      bodyLimit: 16 * 1024,
      preHandler: [
        app.authenticate,
        app.requireAction("api_keys.read_rotate"),
        async (request) => {
          parseApiKeyRotationBody(request.body);
        },
        async (request, reply) => {
          const context = userContext(request.authContext);
          const decision = await runtime.limiter.admit(context, "POST", "/api/api-keys/rotate");
          if (!decision.allowed) return rateLimited(reply, decision.retryAfterSeconds);
        },
      ],
      schema: {
        body: apiKeyRotationBodySchema,
        response: { 200: apiKeyRotationResponseSchema, ...apiKeyRotationResponseSchemas },
      },
    },
    async (request, reply) => {
      const result = await runtime.service.rotate(userContext(request.authContext), request.body);
      return reply.code(200).send(result);
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
    message: "Too many API-key rotation requests.",
    statusCode: 429,
    details: [],
  });
  return reply.code(429).send(toErrorEnvelope(error));
}
