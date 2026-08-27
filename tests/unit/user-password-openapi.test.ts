import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("password provisioning OpenAPI contract", () => {
  it("documents one exact JWT-only 204 route and closed write-only password body", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const start = document.indexOf("  /api/users/{id}/credentials/password:");
    const end = document.indexOf("\n  /api/api-keys:", start);
    const route = document.slice(start, end);
    const schemaStart = document.indexOf("    UserPasswordRequest:");
    const schemaEnd = document.indexOf("\n    UserError:", schemaStart);
    const schema = document.slice(schemaStart, schemaEnd);

    expect(start).toBeGreaterThan(0);
    expect(route).toContain("operationId: provisionTenantUserPassword");
    expect(route).toContain("x-required-action: users.read_manage");
    expect(route).toContain("JwtBearer");
    expect(route).not.toContain("AnalystApiKey");
    expect(route).toContain('"204":');
    for (const status of ["400", "401", "403", "404", "413", "429", "503"]) {
      expect(route).toContain(`"${status}":`);
    }
    expect(route).not.toContain('"200":');
    expect(schema).toContain("additionalProperties: false");
    expect(schema).toContain("required: [password]");
    expect(schema).toContain("writeOnly: true");
    expect(schema).not.toMatch(/example:/u);
  });

  it("keeps credential-free POST users separate from the now-owned login endpoint", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const users = document.slice(
      document.indexOf("  /api/users:"),
      document.indexOf("  /api/users/{id}:", document.indexOf("  /api/users:")),
    );

    expect(document).toContain("  /api/auth/login:");
    expect(users).toContain("operationId: createTenantUser");
    expect(users).toContain("Creates no credential, session, invitation, or access token.");
    expect(users).toContain("#/components/schemas/UserCreateRequest");
    expect(users).not.toContain("UserPasswordRequest");
  });
});
