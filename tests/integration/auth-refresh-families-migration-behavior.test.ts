import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  insertRefreshFamily,
  insertRefreshTenant,
  insertRefreshUser,
} from "./helpers/auth-refresh-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_refresh_family_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("same-tenant stable refresh family ownership", () => {
  it("accepts a same-tenant user and keeps two tenants isolated", async () => {
    const tenantA = await insertRefreshTenant(client, "Refresh family tenant A");
    const tenantB = await insertRefreshTenant(client, "Refresh family tenant B");
    const userA = await insertRefreshUser(client, tenantA, "refresh-family-a");
    const userB = await insertRefreshUser(client, tenantB, "refresh-family-b");
    await insertRefreshFamily(client, tenantA, userA);
    await insertRefreshFamily(client, tenantB, userB);
    const crossTenant = await client.query<{ count: string }>(
      `SELECT count(*) FROM auth_refresh_families WHERE tenant_id = $1 AND user_id = $2`,
      [tenantA, userB],
    );
    const counts = await client.query<{ tenant_id: string; count: string }>(
      `SELECT tenant_id, count(*) FROM auth_refresh_families
       WHERE tenant_id IN ($1, $2) GROUP BY tenant_id ORDER BY tenant_id`,
      [tenantA, tenantB],
    );
    expect(crossTenant.rows[0]?.count).toBe("0");
    expect(counts.rows).toEqual(
      [tenantA, tenantB].sort().map((tenant_id) => ({ tenant_id, count: "1" })),
    );
  });

  it("rejects cross-tenant users and orphan owners", async () => {
    const tenantA = await insertRefreshTenant(client, "Refresh owner tenant A");
    const tenantB = await insertRefreshTenant(client, "Refresh owner tenant B");
    const userB = await insertRefreshUser(client, tenantB, "refresh-owner-b");
    await expect(insertRefreshFamily(client, tenantA, userB)).rejects.toMatchObject({
      constraint: "auth_refresh_families_tenant_user_fkey",
    });
    await expect(insertRefreshFamily(client, tenantA, randomUUID())).rejects.toMatchObject({
      constraint: "auth_refresh_families_tenant_user_fkey",
    });
    await expect(insertRefreshFamily(client, randomUUID(), userB)).rejects.toMatchObject({
      constraint: "auth_refresh_families_tenant_id_fkey",
    });
  });

  it("restricts ordinary deletion of an owning user", async () => {
    const tenantId = await insertRefreshTenant(client, "Refresh retained tenant");
    const userId = await insertRefreshUser(client, tenantId, "refresh-retained-user");
    await insertRefreshFamily(client, tenantId, userId);
    await expect(client.query("DELETE FROM users WHERE id = $1", [userId])).rejects.toMatchObject({
      constraint: "auth_refresh_families_tenant_user_fkey",
    });
  });
});

describe("absolute expiry and authoritative revocation", () => {
  it.each([
    [
      "absolute expiry",
      "2026-01-01T00:00:00Z",
      null,
      null,
      "2026-01-01T00:00:00Z",
      "auth_refresh_families_absolute_expiry_check",
    ],
    [
      "updated chronology",
      "2026-02-01T00:00:00Z",
      null,
      null,
      "2025-12-31T00:00:00Z",
      "auth_refresh_families_timestamps_ordered_check",
    ],
    [
      "reason without time",
      "2026-02-01T00:00:00Z",
      null,
      "logout",
      "2026-01-01T00:00:00Z",
      "auth_refresh_families_revocation_coupling_check",
    ],
    [
      "time without reason",
      "2026-02-01T00:00:00Z",
      "2026-01-02T00:00:00Z",
      null,
      "2026-01-01T00:00:00Z",
      "auth_refresh_families_revocation_coupling_check",
    ],
    [
      "revocation chronology",
      "2026-02-01T00:00:00Z",
      "2025-12-31T00:00:00Z",
      "logout",
      "2026-01-01T00:00:00Z",
      "auth_refresh_families_revocation_chronology_check",
    ],
  ])("rejects invalid %s", async (_label, expiry, revokedAt, reason, updatedAt, constraint) => {
    const tenantId = await insertRefreshTenant(client, `Invalid family ${_label}`);
    const userId = await insertRefreshUser(client, tenantId, `invalid-family-${randomUUID()}`);
    await expect(
      client.query(
        `INSERT INTO auth_refresh_families
           (tenant_id, user_id, absolute_expires_at, revoked_at, revocation_reason, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, '2026-01-01T00:00:00Z', $6)`,
        [tenantId, userId, expiry, revokedAt, reason, updatedAt],
      ),
    ).rejects.toMatchObject({ constraint });
  });

  it("rejects every reason outside the exact allowlist", async () => {
    const tenantId = await insertRefreshTenant(client, "Invalid revocation reason tenant");
    const userId = await insertRefreshUser(client, tenantId, "invalid-revocation-reason");
    await expect(
      client.query(
        `INSERT INTO auth_refresh_families
           (tenant_id, user_id, absolute_expires_at, revoked_at, revocation_reason)
         VALUES ($1, $2, now() + interval '30 days', now(), 'expired')`,
        [tenantId, userId],
      ),
    ).rejects.toMatchObject({ constraint: "auth_refresh_families_revocation_reason_check" });
  });

  it("permits one revocation, advances updated_at, and never clears or re-reasons it", async () => {
    const tenantId = await insertRefreshTenant(client, "Authoritative revocation tenant");
    const userId = await insertRefreshUser(client, tenantId, "authoritative-revocation-user");
    const familyId = await insertRefreshFamily(client, tenantId, userId);
    const before = await client.query<{ updated_at: Date }>(
      "SELECT updated_at FROM auth_refresh_families WHERE id = $1",
      [familyId],
    );
    await client.query("SELECT pg_sleep(0.02)");
    const revoked = await client.query<{ advanced: boolean; reason: string }>(
      `UPDATE auth_refresh_families SET revoked_at = now(), revocation_reason = 'logout'
       WHERE id = $1 RETURNING updated_at > $2 AS advanced, revocation_reason AS reason`,
      [familyId, before.rows[0]!.updated_at],
    );
    expect(revoked.rows[0]).toEqual({ advanced: true, reason: "logout" });
    await expect(
      client.query(
        "UPDATE auth_refresh_families SET revoked_at = NULL, revocation_reason = NULL WHERE id = $1",
        [familyId],
      ),
    ).rejects.toThrow(/revocation is immutable/iu);
    await expect(
      client.query(
        "UPDATE auth_refresh_families SET revocation_reason = 'reuse_detected' WHERE id = $1",
        [familyId],
      ),
    ).rejects.toThrow(/revocation is immutable/iu);
  });

  it("rejects tenant, user, absolute-expiry, and creation mutation", async () => {
    const tenantId = await insertRefreshTenant(client, "Immutable family tenant");
    const userId = await insertRefreshUser(client, tenantId, "immutable-family-user");
    const familyId = await insertRefreshFamily(client, tenantId, userId);
    for (const mutation of [
      "tenant_id = gen_random_uuid()",
      "user_id = gen_random_uuid()",
      "absolute_expires_at = absolute_expires_at + interval '1 day'",
      "created_at = created_at - interval '1 day'",
    ]) {
      await expect(
        client.query(`UPDATE auth_refresh_families SET ${mutation} WHERE id = $1`, [familyId]),
      ).rejects.toThrow(/family identity and lifetime are immutable/iu);
    }
  });
});
