import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createApiKeyMetadataRepository } from "../../core/tenant/api-key-metadata-repository.js";

describe("API-key metadata repository contract", () => {
  it("executes the exact tenant-parameterized metadata keyset projection with limit+1", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const pool = {
      query: async (text: string, values: unknown[]) => {
        calls.push({ text, values });
        return { rows: [] };
      },
    };
    const repository = createApiKeyMetadataRepository(pool as never);

    await repository.list({
      tenantId: "11111111-1111-4111-8111-111111111111",
      limit: 25,
      cursor: {
        createdAt: "2026-01-02T03:04:05.123456Z",
        id: "22222222-2222-4222-8222-222222222222",
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "2026-01-02T03:04:05.123456Z",
      "22222222-2222-4222-8222-222222222222",
      26,
    ]);
    expect(calls[0]!.text).toMatch(/SELECT\s+id,\s*note,/iu);
    expect(calls[0]!.text).toContain("WHERE tenant_id = $1");
    expect(calls[0]!.text).toContain("(created_at, id) < ($2::timestamptz, $3::uuid)");
    expect(calls[0]!.text).toContain("ORDER BY created_at DESC, id DESC");
    expect(calls[0]!.text).toContain("LIMIT $4");
  });

  it("guards the production listing source against wildcard or credential projection", async () => {
    const source = await readFile("core/tenant/api-key-metadata-repository.ts", "utf8");
    const projection = source.slice(source.indexOf("const API_KEY_METADATA_PROJECTION"));

    expect(projection).not.toMatch(/SELECT\s+\*/iu);
    expect(projection).not.toMatch(/(?:key_hash|plaintext|fingerprint|prefix)/iu);
    expect(projection).toMatch(/id, note/iu);
    expect(projection).toMatch(/created_at/iu);
    expect(projection).toMatch(/revoked_at/iu);
  });
});
