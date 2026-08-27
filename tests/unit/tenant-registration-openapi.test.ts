import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("tenant registration OpenAPI contract", () => {
  it("owns the exact public request and response surface without digest/hash fields", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const route = document.slice(
      document.indexOf("  /api/tenants/register:"),
      document.indexOf("  /tenants/me:"),
    );

    expect(route).toContain("operationId: registerTenant");
    expect(route).toContain("security: []");
    expect(route).toContain("name: Idempotency-Key");
    expect(document).toContain('x-maximum: "9223372036854775807"');
    expect(route).toContain('"201":');
    for (const status of ["400", "404", "409", "413", "429", "503"]) {
      expect(route).toContain(`"${status}":`);
    }
    expect(route).not.toMatch(/(?:sha256|key_hash|request_hash|idempotency_key_hash)/iu);
    expect(route).not.toContain("TODO define response schema");
  });
});
