import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("tenant profile OpenAPI contract", () => {
  it("defines the exact protected metadata-only response and errors", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const route = document.slice(
      document.indexOf("  /tenants/me:"),
      document.indexOf("  /api/users:"),
    );

    expect(route).toContain("operationId: getCurrentTenantProfile");
    expect(route).toContain("tenant_profile.read");
    for (const status of ["200", "401", "403", "404", "503"]) {
      expect(route).toContain(`"${status}":`);
    }
    expect(route).toContain('$ref: "#/components/schemas/TenantProfile"');
    expect(route).not.toContain("TODO define response schema");
    expect(route).not.toMatch(/(?:apiKey|key_hash|api_keys|users|password|credential)/u);
  });

  it("keeps BIGINT cents textual and closes every metadata object", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const schema = document.slice(
      document.indexOf("    TenantProfile:"),
      document.indexOf("    TenantRegistrationCreated:"),
    );

    expect(schema).toContain("additionalProperties: false");
    expect(schema).toContain("risk_budget_cents:");
    expect(schema).toContain('x-maximum: "9223372036854775807"');
    expect(schema).toContain('pattern: "^(0|[1-9][0-9]*)$"');
    for (const field of ["address", "registration", "contact_email", "created_at", "updated_at"]) {
      expect(schema).toContain(`${field}:`);
    }
    expect(schema).not.toMatch(/(?:hash|secret|token|password|credential|receipt)/u);
  });
});
