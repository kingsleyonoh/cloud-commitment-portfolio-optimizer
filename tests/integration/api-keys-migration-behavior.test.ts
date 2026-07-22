import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

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

async function insertKey(tenantId: string, note: string | null = null): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, key_hash, note)
     VALUES ($1, gen_random_uuid()::text, $2) RETURNING id`,
    [tenantId, note],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_api_keys_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("API-key metadata lifecycle", () => {
  it("generates database UUID and timestamp defaults without creating credentials", async () => {
    const tenantId = await insertTenant("Key defaults tenant");
    const keyId = await insertKey(tenantId);
    const row = await client.query<{
      id: string;
      note: string | null;
      created_at: Date;
      revoked_at: Date | null;
    }>("SELECT id, note, created_at, revoked_at FROM api_keys WHERE tenant_id = $1 AND id = $2", [
      tenantId,
      keyId,
    ]);

    expect(row.rows[0]).toMatchObject({ id: keyId, note: null, revoked_at: null });
    expect(row.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it("allows multiple active keys for one tenant", async () => {
    const tenantId = await insertTenant("Plural active keys tenant");
    await insertKey(tenantId, "Primary rotation metadata");
    await insertKey(tenantId, "Secondary rotation metadata");
    const active = await client.query<{ note: string }>(
      `SELECT note FROM api_keys
       WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at, id`,
      [tenantId],
    );

    expect(active.rows).toHaveLength(2);
    expect(active.rows.map(({ note }) => note).sort()).toEqual([
      "Primary rotation metadata",
      "Secondary rotation metadata",
    ]);
  });

  it("rejects reuse of one stored hash globally across tenants", async () => {
    const firstTenantId = await insertTenant("Global uniqueness tenant A");
    const secondTenantId = await insertTenant("Global uniqueness tenant B");
    const firstKeyId = await insertKey(firstTenantId);

    await expect(
      client.query(
        `INSERT INTO api_keys (tenant_id, key_hash)
         SELECT $1, key_hash FROM api_keys WHERE tenant_id = $2 AND id = $3`,
        [secondTenantId, firstTenantId, firstKeyId],
      ),
    ).rejects.toThrow(/api_keys_key_hash_key/iu);
  });

  it.each(["", "   ", " Padded note "])("rejects invalid optional note %j", async (note) => {
    const tenantId = await insertTenant(`Invalid note tenant ${JSON.stringify(note)}`);
    await expect(insertKey(tenantId, note)).rejects.toThrow(/api_keys_note_trimmed_check/iu);
  });

  it("rejects revocation before creation", async () => {
    const tenantId = await insertTenant("Chronology rejection tenant");
    await expect(
      client.query(
        `INSERT INTO api_keys (tenant_id, key_hash, created_at, revoked_at)
         VALUES ($1, gen_random_uuid()::text,
                 '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [tenantId],
      ),
    ).rejects.toThrow(/api_keys_revoked_chronology_check/iu);
  });

  it("preserves revoked metadata history and excludes it from active lookup", async () => {
    const tenantId = await insertTenant("Revocation history tenant");
    const keyId = await insertKey(tenantId, "Retained rotation metadata");
    await client.query(
      `UPDATE api_keys SET revoked_at = created_at + interval '1 second'
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, keyId],
    );
    const history = await client.query<{ id: string; note: string; revoked_at: Date }>(
      "SELECT id, note, revoked_at FROM api_keys WHERE tenant_id = $1 AND id = $2",
      [tenantId, keyId],
    );
    const active = await client.query<{ id: string }>(
      "SELECT id FROM api_keys WHERE tenant_id = $1 AND revoked_at IS NULL",
      [tenantId],
    );

    expect(history.rows[0]).toMatchObject({ id: keyId, note: "Retained rotation metadata" });
    expect(history.rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(active.rows).toEqual([]);
  });
});

describe("API-key tenant ownership", () => {
  it("rejects orphan keys and restricts deletion of an owning tenant", async () => {
    const tenantId = await insertTenant("Restricted key owner tenant");
    await insertKey(tenantId);
    await expect(insertKey("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      /api_keys_tenant_id_fkey/iu,
    );
    await expect(client.query("DELETE FROM tenants WHERE id = $1", [tenantId])).rejects.toThrow(
      /api_keys_tenant_id_fkey/iu,
    );
  });

  it("tenant-leading active and point lookups exclude other tenant metadata", async () => {
    const firstTenantId = await insertTenant("Key query tenant A");
    const secondTenantId = await insertTenant("Key query tenant B");
    const firstKeyId = await insertKey(firstTenantId, "First tenant metadata");
    await insertKey(secondTenantId, "Other tenant metadata");
    const list = await client.query<{ id: string; note: string }>(
      `SELECT id, note FROM api_keys
       WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at, id`,
      [firstTenantId],
    );
    const crossTenantPoint = await client.query<{ id: string }>(
      "SELECT id FROM api_keys WHERE tenant_id = $1 AND id = $2",
      [secondTenantId, firstKeyId],
    );

    expect(list.rows).toEqual([{ id: firstKeyId, note: "First tenant metadata" }]);
    expect(JSON.stringify(list.rows)).not.toContain("Other tenant metadata");
    expect(crossTenantPoint.rows).toEqual([]);
  });
});
