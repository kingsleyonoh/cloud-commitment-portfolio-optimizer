import type { FastifyInstance } from "fastify";

import type { TenantProfileService } from "../../../core/tenant/profile-service.js";
import { tenantProfileSchema } from "./tenant-registration-schema.js";

export interface TenantProfileRuntime {
  service: TenantProfileService;
}

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "details"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "array", maxItems: 0 },
      },
    },
  },
} as const;

export function registerTenantProfileRoute(
  app: FastifyInstance,
  runtime: TenantProfileRuntime,
): void {
  app.get(
    "/tenants/me",
    {
      preHandler: [app.authenticate, app.requireAction("tenant_profile.read")],
      schema: {
        response: {
          200: tenantProfileSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request) => runtime.service.getCurrent(request.authContext!.tenantId),
  );
}
