import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("users OpenAPI contract", () => {
  it("consolidates one exact JWT-only users collection path", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const occurrences = document.match(/^ {2}\/api\/users:$/gmu) ?? [];
    const collection = document.slice(
      document.indexOf("  /api/users:"),
      document.indexOf("  /api/users/{id}:"),
    );

    expect(occurrences).toHaveLength(1);
    expect(collection).toContain("operationId: listTenantUsers");
    expect(collection).toContain("operationId: createTenantUser");
    expect(collection).toContain("users.read_manage");
    expect(collection).toContain("default: 25");
    expect(collection).toContain("maximum: 100");
    expect(collection).toContain('"201":');
    expect(collection).not.toContain("AnalystApiKey");
    expect(collection).not.toContain("TODO define response schema");
  });

  it("documents exact closed public schemas, conflicts, and rolling limits", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const schema = document.slice(
      document.indexOf("    UserRole:"),
      document.indexOf("    UserPasswordRequest:"),
    );
    const routes = document.slice(
      document.indexOf("  /api/users:"),
      document.indexOf("  /api/users/{id}/credentials/password:"),
    );

    for (const field of ["id", "email", "name", "role", "is_active", "created_at", "updated_at"]) {
      expect(schema).toContain(`${field}:`);
    }
    expect(schema).toContain("additionalProperties: false");
    expect(schema).toContain("expected_updated_at");
    expect(schema).toContain("tenant_admin");
    expect(schema).toContain("read_only_auditor");
    expect(schema).not.toMatch(/(?:password|token|secret|key_hash|tenant_id|owner|status:)/u);
    for (const status of ["400", "401", "403", "404", "409", "429", "503"]) {
      expect(routes).toContain(`"${status}":`);
    }
    expect(routes).toContain("rolling 60-second window");
    expect(routes).toContain("Retry-After");
    expect(routes).not.toContain("AnalystApiKey");
  });
});
