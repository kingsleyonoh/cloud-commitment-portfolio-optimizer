import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("targeted API-key rotation OpenAPI contract", () => {
  it("publishes the exact JWT-only selected-key route and complete response surface", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const routeStart = document.indexOf("  /api/api-keys/rotate:");
    const routeEnd = document.indexOf("  /api/cloud-accounts:", routeStart);
    const route = document.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThan(-1);
    expect(document.match(/^ {2}\/api\/api-keys\/rotate:$/gmu)).toHaveLength(1);
    expect(route).toContain("operationId: rotateTenantApiKey");
    expect(route).toContain("x-required-action: api_keys.read_rotate");
    expect(route).toContain("JwtBearer");
    expect(route).not.toContain("AnalystApiKey");
    expect(route).not.toMatch(/tenant_id|version|idempotency|old_api_key/iu);
    for (const status of ["200", "400", "401", "403", "404", "413", "429", "503"]) {
      expect(route).toContain(`"${status}":`);
    }
  });

  it("marks only the one-time apiKey writeOnly and publishes no concrete secret example", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const start = document.indexOf("    ApiKeyRotationRequest:");
    const end = document.indexOf("paths:", start);
    const schemas = document.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(schemas).toContain("additionalProperties: false");
    expect(schemas).toContain("api_key_id:");
    expect(schemas).toContain("maxLength: 200");
    expect(schemas).toContain("apiKey:");
    expect(schemas).toContain("writeOnly: true");
    expect(schemas).not.toMatch(/example\s*:/u);
    expect(schemas).not.toMatch(/key_hash|tenant_id|fingerprint|prefix/iu);
  });
});
