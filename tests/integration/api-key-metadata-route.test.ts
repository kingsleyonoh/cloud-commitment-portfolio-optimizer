import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiKeyCredential } from "../../core/tenant/api-key-credential.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  apiKeyMetadataAuthorization,
  closeApiKeyMetadataHarness,
  createApiKeyMetadataHarness,
  type ApiKeyMetadataHarness,
} from "./helpers/api-key-metadata-app.js";

let harness: ApiKeyMetadataHarness;

beforeAll(async () => {
  harness = await createApiKeyMetadataHarness("ccpo_api_key_metadata");
});

afterAll(async () => {
  await closeApiKeyMetadataHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("GET /api/api-keys", () => {
  it("requires exactly one database-confirmed tenant_admin JWT", async () => {
    const missing = await harness.app.inject({ method: "GET", url: "/api/api-keys" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("AUTH_REQUIRED");

    for (const role of ["finops_analyst", "finance_approver", "read_only_auditor"] as const) {
      const denied = await harness.app.inject({
        method: "GET",
        url: "/api/api-keys",
        headers: apiKeyMetadataAuthorization(harness, role, role),
      });
      expect(denied.statusCode, role).toBe(403);
      expect(denied.json().error.code, role).toBe("FORBIDDEN");
    }
    const apiKey = await harness.app.inject({
      method: "GET",
      url: "/api/api-keys",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(apiKey.statusCode).toBe(403);
    expect(apiKey.json().error.code).toBe("FORBIDDEN");

    const dual = await harness.app.inject({
      method: "GET",
      url: "/api/api-keys",
      headers: {
        ...apiKeyMetadataAuthorization(harness),
        "x-api-key": harness.analystApiKey,
      },
    });
    expect(dual.statusCode).toBe(401);
    expect(dual.json().error.code).toBe("AUTH_CREDENTIAL_CONFLICT");

    const staleRole = await harness.app.inject({
      method: "GET",
      url: "/api/api-keys",
      headers: apiKeyMetadataAuthorization(harness, "finops_analyst", "tenant_admin"),
    });
    expect(staleRole.statusCode).toBe(401);
    expect(staleRole.json().error.code).toBe("AUTH_INVALID");
  });

  it("returns only four safe stored fields from the authenticated tenant", async () => {
    const distinctHashes = await harness.pool.query<{ count: number }>(
      "SELECT count(DISTINCT key_hash)::int AS count FROM api_keys",
    );
    expect(distinctHashes.rows[0]!.count).toBe(3);

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/api-keys",
      headers: apiKeyMetadataAuthorization(harness),
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(body).toEqual({
      api_keys: [
        {
          id: harness.metadataIds[0],
          note: "visible-current",
          created_at: "2026-01-02T00:00:00.123456Z",
          revoked_at: null,
        },
        {
          id: harness.metadataIds[1],
          note: "visible-revoked",
          created_at: "2026-01-01T00:00:00.654321Z",
          revoked_at: "2026-01-03T00:00:00.000001Z",
        },
      ],
      next_cursor: null,
    });
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toContain("cross-tenant-hidden");
    expect(response.body).not.toMatch(
      /(?:tenant_id|key_hash|plaintext|secret|fingerprint|prefix)/iu,
    );
  });

  it("traverses tied keysets without duplicates and excludes a concurrent newer insert", async () => {
    const initialIds = [...harness.metadataIds];
    for (let index = 0; index < 27; index += 1) {
      const credential = createApiKeyCredential("ccpo");
      const inserted = await harness.pool.query<{ id: string }>(
        `INSERT INTO api_keys (tenant_id, key_hash, note, created_at)
         VALUES ($1, $2, $3, '2025-12-31T00:00:00.999999Z') RETURNING id`,
        [harness.tenantA, credential.keyHash, `page-${index}`],
      );
      initialIds.push(inserted.rows[0]!.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let insertedNewer = "";
    do {
      const query = new URLSearchParams({ limit: "7" });
      if (cursor) query.set("cursor", cursor);
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/api-keys?${query}`,
        headers: apiKeyMetadataAuthorization(harness),
      });
      expect(response.statusCode).toBe(200);
      const page = response.json();
      seen.push(...page.api_keys.map((item: { id: string }) => item.id));
      cursor = page.next_cursor;
      if (!insertedNewer) {
        const credential = createApiKeyCredential("ccpo");
        const inserted = await harness.pool.query<{ id: string }>(
          `INSERT INTO api_keys (tenant_id, key_hash, note, created_at)
           VALUES ($1, $2, 'concurrent-newer', '2026-02-01T00:00:00.000001Z') RETURNING id`,
          [harness.tenantA, credential.keyHash],
        );
        insertedNewer = inserted.rows[0]!.id;
      }
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(insertedNewer);
    expect([...seen].sort()).toEqual(initialIds.sort());
  });

  it("rejects noncanonical, tampered, tenant-selecting, filtering, and unknown query members", async () => {
    const first = await harness.app.inject({
      method: "GET",
      url: "/api/api-keys?limit=1",
      headers: apiKeyMetadataAuthorization(harness),
    });
    const cursor = first.json().next_cursor as string;
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    for (const query of [
      "limit=0",
      "limit=01",
      "limit=101",
      `cursor=${tampered}`,
      `tenant_id=${harness.tenantB}`,
      "status=active",
      "unknown=value",
    ]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/api-keys?${query}`,
        headers: apiKeyMetadataAuthorization(harness),
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json(), query).toEqual({
        error: { code: "VALIDATION_ERROR", message: "Request is invalid.", details: [] },
      });
    }
  });

  it("returns a safe 503 when the metadata table is unavailable", async () => {
    await harness.pool.query("ALTER TABLE api_keys RENAME TO api_keys_unavailable_test");
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/api-keys",
        headers: apiKeyMetadataAuthorization(harness),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: {
          code: "API_KEYS_UNAVAILABLE",
          message: "API-key metadata is temporarily unavailable.",
          details: [],
        },
      });
    } finally {
      await harness.pool.query("ALTER TABLE api_keys_unavailable_test RENAME TO api_keys");
    }
  });

  it("returns the exact empty closed page", async () => {
    await harness.pool.query("DELETE FROM registration_requests");
    await harness.pool.query("DELETE FROM api_keys WHERE tenant_id = $1", [harness.tenantA]);
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/api-keys",
      headers: apiKeyMetadataAuthorization(harness),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ api_keys: [], next_cursor: null });
  });
});
