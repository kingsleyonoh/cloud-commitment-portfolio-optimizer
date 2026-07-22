import { expect, it, vi } from "vitest";

import { createApiKeyRotationService } from "../../core/tenant/api-key-rotation-service.js";
import { createUserRequestContext } from "../../core/tenant/request-context.js";

const context = createUserRequestContext({
  tenantId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "22222222-2222-4222-8222-222222222222",
  role: "tenant_admin",
  requestId: "rotation-generation-failure",
});

it("maps credential-generation failure safely and never reaches the repository", async () => {
  const rotate = vi.fn();
  const service = createApiKeyRotationService({ rotate }, "ccpo", () => {
    throw new Error("entropy unavailable");
  });

  await expect(
    service.rotate(context, { api_key_id: "33333333-3333-4333-8333-333333333333" }),
  ).rejects.toMatchObject({
    code: "API_KEY_ROTATION_UNAVAILABLE",
    statusCode: 503,
    details: [],
  });
  expect(rotate).not.toHaveBeenCalled();
});
