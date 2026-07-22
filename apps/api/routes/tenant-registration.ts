import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError, toErrorEnvelope } from "../../../core/shared/errors.js";
import type { RegistrationLimiter } from "../../../core/tenant/registration-limiter.js";
import type { TenantRegistrationService } from "../../../core/tenant/registration-service.js";
import type { TenantRegistrationBody } from "../../../core/tenant/registration-types.js";
import {
  tenantRegistrationBodySchema,
  tenantRegistrationResponseSchema,
} from "./tenant-registration-schema.js";

export interface TenantRegistrationRuntime {
  limiter: RegistrationLimiter;
  service: TenantRegistrationService;
}

export function registerTenantRegistrationRoute(
  app: FastifyInstance,
  runtime: TenantRegistrationRuntime,
): void {
  app.addHook("onClose", async () => runtime.limiter.close?.());
  app.post<{ Body: TenantRegistrationBody }>(
    "/api/tenants/register",
    {
      bodyLimit: 16_384,
      schema: {
        body: tenantRegistrationBodySchema,
        response: tenantRegistrationResponseSchema,
      },
      onRequest: async (request, reply) => registrationBoundary(request, reply, runtime),
    },
    async (request, reply) => {
      const idempotencyKey = singleIdempotencyHeader(request);
      const created = await runtime.service.register(idempotencyKey, request.body);
      return reply.code(201).send(created);
    },
  );
}

async function registrationBoundary(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: TenantRegistrationRuntime,
): Promise<FastifyReply | void> {
  const decision = await runtime.limiter.admit(request.ip);
  if (!decision.allowed) {
    reply.header("retry-after", String(decision.retryAfterSeconds ?? 1));
    const error = new AppError({
      code: "RATE_LIMITED",
      message: "Too many registration attempts.",
      statusCode: 429,
    });
    return reply.code(429).send(toErrorEnvelope(error));
  }
  if (!isJsonContentType(request.headers["content-type"])) throw validationError();
}

function singleIdempotencyHeader(request: FastifyRequest): string {
  const distinct = request.raw.headersDistinct?.["idempotency-key"];
  if (distinct && distinct.length !== 1) throw validationError();
  const values: string[] = [];
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    if (request.raw.rawHeaders[index]?.toLowerCase() === "idempotency-key") {
      values.push(request.raw.rawHeaders[index + 1] ?? "");
    }
  }
  if (values.length !== 1) throw validationError();
  return values[0]!;
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function validationError(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Registration request is invalid.",
    statusCode: 400,
  });
}
