import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  insertRefreshFamily,
  insertRefreshTenant,
  insertRefreshToken,
  insertRefreshUser,
  runtimeDigests,
} from "./helpers/auth-refresh-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

async function owner(label: string): Promise<[string, string, string]> {
  const tenantId = await insertRefreshTenant(client, `${label} tenant`);
  const userId = await insertRefreshUser(client, tenantId, `${label}-${randomUUID()}`);
  const familyId = await insertRefreshFamily(client, tenantId, userId);
  return [tenantId, userId, familyId];
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_refresh_token_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("digest and same-tenant token ownership", () => {
  it("accepts runtime-generated 32-byte digests without exposing their values", async () => {
    const [tenantId, , familyId] = await owner("valid-token");
    const tokenId = await insertRefreshToken(client, tenantId, familyId);
    const result = await client.query<{
      token_length: number;
      csrf_length: number;
      ordered: boolean;
    }>(
      `SELECT octet_length(token_digest) AS token_length,
              octet_length(csrf_digest) AS csrf_length,
              idle_expires_at > created_at AND updated_at >= created_at AS ordered
       FROM auth_refresh_tokens WHERE id = $1`,
      [tokenId],
    );
    expect(result.rows[0]).toEqual({ token_length: 32, csrf_length: 32, ordered: true });
  });

  it.each([
    ["short token digest", 31, 32, "auth_refresh_tokens_token_digest_length_check"],
    ["long token digest", 33, 32, "auth_refresh_tokens_token_digest_length_check"],
    ["short CSRF digest", 32, 31, "auth_refresh_tokens_csrf_digest_length_check"],
    ["long CSRF digest", 32, 33, "auth_refresh_tokens_csrf_digest_length_check"],
  ])("rejects %s", async (_label, tokenLength, csrfLength, constraint) => {
    const [tenantId, , familyId] = await owner(`invalid-digest-${tokenLength}-${csrfLength}`);
    await expect(
      client.query(
        `INSERT INTO auth_refresh_tokens
           (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
        [tenantId, familyId, randomBytes(tokenLength), randomBytes(csrfLength)],
      ),
    ).rejects.toMatchObject({ constraint });
  });

  it("globally rejects a duplicate token digest while allowing a repeated CSRF digest", async () => {
    const [tenantA, , familyA] = await owner("digest-unique-a");
    const [tenantB, , familyB] = await owner("digest-unique-b");
    const [tokenDigest, csrfDigest] = runtimeDigests();
    await client.query(
      `INSERT INTO auth_refresh_tokens
         (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at, used_at)
       VALUES ($1, $2, $3, $4, now() + interval '7 days', now())`,
      [tenantA, familyA, tokenDigest, csrfDigest],
    );
    await expect(
      client.query(
        `INSERT INTO auth_refresh_tokens
           (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
        [tenantB, familyB, tokenDigest, randomBytes(32)],
      ),
    ).rejects.toMatchObject({ constraint: "auth_refresh_tokens_token_digest_key" });
    const accepted = await client.query<{ id: string }>(
      `INSERT INTO auth_refresh_tokens
         (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING id`,
      [tenantB, familyB, randomBytes(32), csrfDigest],
    );
    expect(accepted.rowCount).toBe(1);
  });

  it("rejects cross-tenant and orphan family ownership", async () => {
    const [tenantA] = await owner("token-owner-a");
    const [tenantB, , familyB] = await owner("token-owner-b");
    await expect(insertRefreshToken(client, tenantA, familyB)).rejects.toMatchObject({
      constraint: "auth_refresh_tokens_tenant_family_fkey",
    });
    await expect(insertRefreshToken(client, tenantB, randomUUID())).rejects.toMatchObject({
      constraint: "auth_refresh_tokens_tenant_family_fkey",
    });
    await expect(insertRefreshToken(client, randomUUID(), familyB)).rejects.toMatchObject({
      constraint: "auth_refresh_tokens_tenant_id_fkey",
    });
  });
});

describe("token chronology and one-time use", () => {
  it.each([
    [
      "idle expiry",
      "2026-01-01T00:00:00Z",
      null,
      "2026-01-01T00:00:00Z",
      "auth_refresh_tokens_idle_expiry_check",
    ],
    [
      "used chronology",
      "2026-02-01T00:00:00Z",
      "2025-12-31T00:00:00Z",
      "2026-01-01T00:00:00Z",
      "auth_refresh_tokens_timestamps_ordered_check",
    ],
    [
      "updated chronology",
      "2026-02-01T00:00:00Z",
      null,
      "2025-12-31T00:00:00Z",
      "auth_refresh_tokens_timestamps_ordered_check",
    ],
  ])("rejects invalid %s", async (_label, idleExpiry, usedAt, updatedAt, constraint) => {
    const [tenantId, , familyId] = await owner(`invalid-token-time-${_label}`);
    const [tokenDigest, csrfDigest] = runtimeDigests();
    await expect(
      client.query(
        `INSERT INTO auth_refresh_tokens
           (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at,
            used_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-01-01T00:00:00Z', $7)`,
        [tenantId, familyId, tokenDigest, csrfDigest, idleExpiry, usedAt, updatedAt],
      ),
    ).rejects.toMatchObject({ constraint });
  });

  it("allows exactly one database-timestamped unused-to-used transition", async () => {
    const [tenantId, , familyId] = await owner("one-time-token");
    const tokenId = await insertRefreshToken(client, tenantId, familyId);
    const before = await client.query<{ updated_at: Date }>(
      "SELECT updated_at FROM auth_refresh_tokens WHERE id = $1",
      [tokenId],
    );
    await client.query("SELECT pg_sleep(0.02)");
    const used = await client.query<{ used: boolean; advanced: boolean; same_clock: boolean }>(
      `UPDATE auth_refresh_tokens SET used_at = '2099-01-01T00:00:00Z'
       WHERE id = $1
       RETURNING used_at IS NOT NULL AS used, updated_at > $2 AS advanced,
                 used_at = updated_at AS same_clock`,
      [tokenId, before.rows[0]!.updated_at],
    );
    expect(used.rows[0]).toEqual({ used: true, advanced: true, same_clock: true });
    await expect(
      client.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id = $1", [tokenId]),
    ).rejects.toThrow(/token use is immutable/iu);
    await expect(
      client.query("UPDATE auth_refresh_tokens SET used_at = NULL WHERE id = $1", [tokenId]),
    ).rejects.toThrow(/token use is immutable/iu);
  });

  it("rejects identity, lineage, digest, expiry, and creation mutation", async () => {
    const [tenantId, , familyId] = await owner("immutable-token");
    const tokenId = await insertRefreshToken(client, tenantId, familyId);
    for (const mutation of [
      "tenant_id = gen_random_uuid()",
      "family_id = gen_random_uuid()",
      "parent_token_id = gen_random_uuid()",
      "token_digest = decode(repeat('00', 32), 'hex')",
      "csrf_digest = decode(repeat('00', 32), 'hex')",
      "idle_expires_at = idle_expires_at + interval '1 day'",
      "created_at = created_at - interval '1 day'",
    ]) {
      await expect(
        client.query(`UPDATE auth_refresh_tokens SET ${mutation}, used_at = now() WHERE id = $1`, [
          tokenId,
        ]),
      ).rejects.toThrow(/token identity and lifetime are immutable/iu);
    }
  });

  it("rejects a self-parent even before lineage lookup", async () => {
    const [tenantId, , familyId] = await owner("self-parent-token");
    const tokenId = randomUUID();
    const [tokenDigest, csrfDigest] = runtimeDigests();
    await expect(
      client.query(
        `INSERT INTO auth_refresh_tokens
           (id, tenant_id, family_id, parent_token_id, token_digest, csrf_digest, idle_expires_at)
         VALUES ($1, $2, $3, $1, $4, $5, now() + interval '7 days')`,
        [tokenId, tenantId, familyId, tokenDigest, csrfDigest],
      ),
    ).rejects.toMatchObject({ constraint: "auth_refresh_tokens_parent_not_self_check" });
  });
});
