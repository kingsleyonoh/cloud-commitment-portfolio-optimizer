import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("API-key metadata OpenAPI contract", () => {
  it("defines one exact JWT-only collection route with strict pagination and errors", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const occurrences = document.match(/^ {2}\/api\/api-keys:$/gmu) ?? [];
    const route = document.slice(
      document.indexOf("  /api/api-keys:"),
      document.indexOf("  /api/cloud-accounts:"),
    );

    expect(occurrences).toHaveLength(1);
    expect(route).toContain("operationId: listTenantApiKeys");
    expect(route).toContain("api_keys.read_manage");
    expect(route).toContain("default: 25");
    expect(route).toContain("maximum: 100");
    expect(route).toContain("created_at DESC and id DESC");
    expect(route).toContain("JwtBearer");
    expect(route).not.toContain("AnalystApiKey");
    expect(route).not.toContain("TODO define response schema");
    for (const status of ["200", "400", "401", "403", "429", "503"]) {
      expect(route).toContain(`"${status}":`);
    }
  });

  it("publishes only the four safe stored metadata fields in closed schemas", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    const schemas = document.slice(
      document.indexOf("    ApiKeyMetadata:"),
      document.indexOf("    UserRole:"),
    );

    expect(schemas).toContain("additionalProperties: false");
    for (const field of ["id", "note", "created_at", "revoked_at", "api_keys", "next_cursor"]) {
      expect(schemas).toContain(`${field}:`);
    }
    expect(schemas).not.toMatch(
      /(?:key_hash|plaintext|secret|credential|fingerprint|prefix|tenant_id)/iu,
    );
  });
});
