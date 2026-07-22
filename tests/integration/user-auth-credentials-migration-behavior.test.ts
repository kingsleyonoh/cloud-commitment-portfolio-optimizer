import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";
import { syntheticCredentialVerifier } from "./helpers/user-auth-credentials.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

async function insertTenant(label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

async function insertUser(tenantId: string, label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, 'tenant_admin') RETURNING id`,
    [tenantId, `${label}@example.invalid`, label],
  );
  return result.rows[0]!.id;
}

function insertCredential(tenantId: string, userId: string, verifier: string) {
  return client.query<{
    verifier_matches: boolean;
    timestamps_ordered: boolean;
  }>(
    `INSERT INTO user_auth_credentials (tenant_id, user_id, password_hash)
     VALUES ($1, $2, $3)
     RETURNING password_hash = $3 AS verifier_matches,
               password_changed_at >= created_at AND updated_at >= created_at AS timestamps_ordered`,
    [tenantId, userId, verifier],
  );
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_user_credentials_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("same-tenant one-to-one credential ownership", () => {
  it("accepts one verifier for a same-tenant user with ordered defaults", async () => {
    const tenantId = await insertTenant("Credential owner tenant");
    const userId = await insertUser(tenantId, "credential-owner");
    const result = await insertCredential(tenantId, userId, syntheticCredentialVerifier(11));
    expect(result.rows[0]).toEqual({ verifier_matches: true, timestamps_ordered: true });
  });

  it("rejects cross-tenant, orphan-user, and orphan-tenant ownership", async () => {
    const tenantA = await insertTenant("Credential tenant A");
    const tenantB = await insertTenant("Credential tenant B");
    const userB = await insertUser(tenantB, "credential-user-b");
    const verifier = syntheticCredentialVerifier(12);
    await expect(insertCredential(tenantA, userB, verifier)).rejects.toMatchObject({
      constraint: "user_auth_credentials_tenant_user_fkey",
    });
    await expect(
      insertCredential(tenantA, "00000000-0000-0000-0000-000000000001", verifier),
    ).rejects.toMatchObject({ constraint: "user_auth_credentials_tenant_user_fkey" });
    await expect(
      insertCredential("00000000-0000-0000-0000-000000000002", userB, verifier),
    ).rejects.toMatchObject({ constraint: "user_auth_credentials_tenant_id_fkey" });
  });

  it("allows only one credential row per user", async () => {
    const tenantId = await insertTenant("Single credential tenant");
    const userId = await insertUser(tenantId, "single-credential");
    await insertCredential(tenantId, userId, syntheticCredentialVerifier(13));
    await expect(
      insertCredential(tenantId, userId, syntheticCredentialVerifier(14)),
    ).rejects.toMatchObject({ constraint: "user_auth_credentials_pkey" });
  });

  it("restricts deletion of owning users and tenants", async () => {
    const tenantId = await insertTenant("Credential deletion tenant");
    const userId = await insertUser(tenantId, "credential-delete");
    await insertCredential(tenantId, userId, syntheticCredentialVerifier(15));
    await expect(client.query("DELETE FROM users WHERE id = $1", [userId])).rejects.toMatchObject({
      constraint: "user_auth_credentials_tenant_user_fkey",
    });
    await expect(
      client.query("DELETE FROM tenants WHERE id = $1", [tenantId]),
    ).rejects.toMatchObject({ constraint: "users_tenant_id_fkey" });
  });
});

describe("bounded structural verifier and chronology checks", () => {
  it.each([
    ["blank", () => ""],
    ["whitespace", () => "   "],
    ["outer padding", () => ` ${syntheticCredentialVerifier(20)} `],
    ["over schema bound", () => `${syntheticCredentialVerifier(21)}${"x".repeat(513)}`],
    ["wrong PHC marker", () => syntheticCredentialVerifier(22).replace("argon2id", "argon2i")],
    ["wrong PHC version", () => syntheticCredentialVerifier(23).replace("v=19", "v=16")],
  ])("rejects %s verifier text", async (_label, value) => {
    const tenantId = await insertTenant(`Invalid verifier ${_label}`);
    const userId = await insertUser(tenantId, `invalid-verifier-${Math.random()}`);
    await expect(insertCredential(tenantId, userId, value())).rejects.toMatchObject({
      constraint: "user_auth_credentials_password_hash_check",
    });
  });

  it.each([
    ["password changed", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
    ["updated", "2026-01-03T00:00:00Z", "2026-01-02T00:00:00Z"],
  ])("rejects reversed %s chronology", async (_label, changedAt, createdAt) => {
    const tenantId = await insertTenant(`Invalid chronology ${_label}`);
    const userId = await insertUser(tenantId, `invalid-chronology-${Math.random()}`);
    await expect(
      client.query(
        `INSERT INTO user_auth_credentials
           (tenant_id, user_id, password_hash, password_changed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, '2026-01-01T00:00:00Z')`,
        [tenantId, userId, syntheticCredentialVerifier(24), changedAt, createdAt],
      ),
    ).rejects.toMatchObject({ constraint: "user_auth_credentials_timestamps_ordered_check" });
  });
});

describe("database-managed updates and tenant isolation", () => {
  it("advances updated_at, preserves creation, and rejects identity reassignment", async () => {
    const tenantId = await insertTenant("Credential update tenant");
    const userId = await insertUser(tenantId, "credential-update");
    await insertCredential(tenantId, userId, syntheticCredentialVerifier(30));
    const before = await client.query<{ created_at: string; updated_at: Date }>(
      "SELECT created_at::text AS created_at, updated_at FROM user_auth_credentials WHERE user_id = $1",
      [userId],
    );
    await client.query("SELECT pg_sleep(0.02)");
    const updated = await client.query<{
      creation_preserved: boolean;
      updated_advanced: boolean;
      change_ordered: boolean;
    }>(
      `UPDATE user_auth_credentials
       SET password_hash = $2, password_changed_at = now(), created_at = now() + interval '1 day'
       WHERE user_id = $1
       RETURNING created_at::text = $3 AS creation_preserved,
                 updated_at > $4 AS updated_advanced,
                 password_changed_at >= created_at AS change_ordered`,
      [
        userId,
        syntheticCredentialVerifier(31),
        before.rows[0]!.created_at,
        before.rows[0]!.updated_at,
      ],
    );
    expect(updated.rows[0]).toEqual({
      creation_preserved: true,
      updated_advanced: true,
      change_ordered: true,
    });
    await expect(
      client.query("UPDATE user_auth_credentials SET tenant_id = $2 WHERE user_id = $1", [
        userId,
        "00000000-0000-0000-0000-000000000003",
      ]),
    ).rejects.toThrow(/credential identity is immutable/iu);
  });

  it("keeps tenant-leading point queries isolated across two tenants", async () => {
    const tenantA = await insertTenant("Credential isolation tenant A");
    const tenantB = await insertTenant("Credential isolation tenant B");
    const userA = await insertUser(tenantA, "credential-isolation-a");
    const userB = await insertUser(tenantB, "credential-isolation-b");
    await insertCredential(tenantA, userA, syntheticCredentialVerifier(40));
    await insertCredential(tenantB, userB, syntheticCredentialVerifier(41));
    const point = await client.query<{ count: string }>(
      `SELECT count(*) FROM user_auth_credentials
       WHERE tenant_id = $1 AND user_id = $2`,
      [tenantA, userB],
    );
    const counts = await client.query<{ tenant_id: string; count: string }>(
      `SELECT tenant_id, count(*) FROM user_auth_credentials
       WHERE tenant_id IN ($1, $2) GROUP BY tenant_id ORDER BY tenant_id`,
      [tenantA, tenantB],
    );
    expect(point.rows[0]?.count).toBe("0");
    expect(counts.rows).toEqual(
      [tenantA, tenantB].sort().map((tenant_id) => ({ tenant_id, count: "1" })),
    );
  });
});
