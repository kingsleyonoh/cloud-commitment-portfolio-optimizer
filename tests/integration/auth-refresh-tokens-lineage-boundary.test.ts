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

async function owner(label: string): Promise<[string, string]> {
  const tenantId = await insertRefreshTenant(client, `${label} tenant`);
  const userId = await insertRefreshUser(client, tenantId, `${label}-${randomUUID()}`);
  return [tenantId, await insertRefreshFamily(client, tenantId, userId)];
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_refresh_lineage_boundary");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("same-family append and mark-used lineage", () => {
  it("accepts one valid child only after its parent is used", async () => {
    const [tenantId, familyId] = await owner("valid-child");
    const rootId = await insertRefreshToken(client, tenantId, familyId);
    await client.query("BEGIN");
    await client.query("SELECT id FROM auth_refresh_families WHERE id = $1 FOR UPDATE", [familyId]);
    await client.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id = $1", [rootId]);
    const childId = await insertRefreshToken(client, tenantId, familyId, rootId);
    await client.query("COMMIT");
    const lineage = await client.query<{ parent_used: boolean; child_current: boolean }>(
      `SELECT parent.used_at IS NOT NULL AS parent_used,
              child.used_at IS NULL AS child_current
       FROM auth_refresh_tokens parent
       JOIN auth_refresh_tokens child ON child.parent_token_id = parent.id
       WHERE parent.id = $1 AND child.id = $2`,
      [rootId, childId],
    );
    expect(lineage.rows[0]).toEqual({ parent_used: true, child_current: true });
  });

  it("rejects a parent from another family", async () => {
    const [tenantA, familyA] = await owner("lineage-family-a");
    const [tenantB, familyB] = await owner("lineage-family-b");
    const rootA = await insertRefreshToken(client, tenantA, familyA);
    const rootB = await insertRefreshToken(client, tenantB, familyB);
    await client.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id IN ($1, $2)", [
      rootA,
      rootB,
    ]);
    await expect(insertRefreshToken(client, tenantB, familyB, rootA)).rejects.toMatchObject({
      constraint: "auth_refresh_tokens_parent_same_family_fkey",
    });
  });

  it("enforces one root, one child per parent, and one unused current token", async () => {
    const [tenantId, familyId] = await owner("linear-lineage");
    const rootId = await insertRefreshToken(client, tenantId, familyId);
    const [rootDigest, rootCsrf] = runtimeDigests();
    const secondRoot = await client.query(
      `INSERT INTO auth_refresh_tokens
         (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '7 days')
       ON CONFLICT (family_id) WHERE parent_token_id IS NULL DO NOTHING`,
      [tenantId, familyId, rootDigest, rootCsrf],
    );
    expect(secondRoot.rowCount).toBe(0);

    await client.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id = $1", [rootId]);
    const childId = await insertRefreshToken(client, tenantId, familyId, rootId);
    const [currentDigest, currentCsrf] = runtimeDigests();
    const secondCurrent = await client.query(
      `INSERT INTO auth_refresh_tokens
         (tenant_id, family_id, parent_token_id, token_digest, csrf_digest, idle_expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')
       ON CONFLICT (family_id) WHERE used_at IS NULL DO NOTHING`,
      [tenantId, familyId, rootId, currentDigest, currentCsrf],
    );
    expect(secondCurrent.rowCount).toBe(0);

    await client.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id = $1", [childId]);
    await expect(insertRefreshToken(client, tenantId, familyId, rootId)).rejects.toMatchObject({
      constraint: "auth_refresh_tokens_one_child_per_parent_key",
    });
    const nextId = await insertRefreshToken(client, tenantId, familyId, childId);
    expect(nextId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("restricts family deletion and parent-token deletion while lineage exists", async () => {
    const [tenantId, familyId] = await owner("retained-lineage");
    const rootId = await insertRefreshToken(client, tenantId, familyId);
    await client.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id = $1", [rootId]);
    await insertRefreshToken(client, tenantId, familyId, rootId);
    await expect(
      client.query("DELETE FROM auth_refresh_families WHERE id = $1", [familyId]),
    ).rejects.toMatchObject({ constraint: "auth_refresh_tokens_tenant_family_fkey" });
    await expect(
      client.query("DELETE FROM auth_refresh_tokens WHERE id = $1", [rootId]),
    ).rejects.toMatchObject({ constraint: "auth_refresh_tokens_parent_same_family_fkey" });
  });
});

describe("family-lock expiry and revocation authority", () => {
  it("enforces idle-at-most-absolute through the PRD service lock pattern", async () => {
    const [tenantId, familyId] = await owner("absolute-boundary");
    async function lockedInsert(idleExpiry: Date): Promise<number> {
      const [tokenDigest, csrfDigest] = runtimeDigests();
      await client.query("BEGIN");
      try {
        const result = await client.query(
          `WITH locked_family AS MATERIALIZED (
             SELECT absolute_expires_at FROM auth_refresh_families
             WHERE tenant_id = $1 AND id = $2 FOR UPDATE
           )
           INSERT INTO auth_refresh_tokens
             (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at)
           SELECT $1, $2, $3, $4, $5 FROM locked_family
           WHERE $5 <= absolute_expires_at`,
          [tenantId, familyId, tokenDigest, csrfDigest, idleExpiry],
        );
        await client.query("COMMIT");
        return result.rowCount ?? 0;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    expect(await lockedInsert(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000))).toBe(0);
    expect(await lockedInsert(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))).toBe(1);
  });

  it("uses strict expiry and the family row as sole revocation authority", async () => {
    const tenantId = await insertRefreshTenant(client, "Strict validity tenant");
    const userId = await insertRefreshUser(client, tenantId, `strict-validity-${randomUUID()}`);
    const familyId = await insertRefreshFamily(
      client,
      tenantId,
      userId,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );
    const tokenId = await insertRefreshToken(client, tenantId, familyId);
    const validBefore = await client.query<{ count: string }>(
      `SELECT count(*) FROM auth_refresh_tokens token
       JOIN auth_refresh_families family ON family.id = token.family_id
       WHERE token.id = $1 AND token.used_at IS NULL AND family.revoked_at IS NULL
         AND now() < token.idle_expires_at AND now() < family.absolute_expires_at`,
      [tokenId],
    );
    await client.query(
      `UPDATE auth_refresh_families
       SET revoked_at = now(), revocation_reason = 'operator_revoked' WHERE id = $1`,
      [familyId],
    );
    const validAfter = await client.query<{ count: string }>(
      `SELECT count(*) FROM auth_refresh_tokens token
       JOIN auth_refresh_families family ON family.id = token.family_id
       WHERE token.id = $1 AND token.used_at IS NULL AND family.revoked_at IS NULL
         AND now() < token.idle_expires_at AND now() < family.absolute_expires_at`,
      [tokenId],
    );
    expect(validBefore.rows[0]?.count).toBe("1");
    expect(validAfter.rows[0]?.count).toBe("0");
  });

  it("rejects idle expiry equal to token creation", async () => {
    const [tenantId, familyId] = await owner("edge-lineage");
    await expect(
      client.query(
        `INSERT INTO auth_refresh_tokens
           (tenant_id, family_id, token_digest, csrf_digest, idle_expires_at, created_at)
         VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [tenantId, familyId, randomBytes(32), randomBytes(32)],
      ),
    ).rejects.toMatchObject({ constraint: "auth_refresh_tokens_idle_expiry_check" });
  });
});
