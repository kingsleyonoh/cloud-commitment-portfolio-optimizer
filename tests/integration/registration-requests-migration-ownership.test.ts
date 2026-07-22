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
let digestByte = 101;

function digest(): Buffer {
  const value = Buffer.alloc(32, digestByte);
  digestByte = (digestByte % 255) + 1;
  return value;
}

async function insertTenant(label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

async function insertKey(tenantId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, key_hash)
     VALUES ($1, gen_random_uuid()::text) RETURNING id`,
    [tenantId],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_registration_ownership");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("registration request digest and ownership enforcement", () => {
  it.each([
    ["idempotency_key_hash", 31],
    ["idempotency_key_hash", 33],
    ["request_sha256", 31],
    ["request_sha256", 33],
  ])("rejects a %s digest with %i bytes", async (column, length) => {
    const keyHash = column === "idempotency_key_hash" ? Buffer.alloc(length) : digest();
    const requestHash = column === "request_sha256" ? Buffer.alloc(length) : digest();
    await expect(
      client.query(
        "INSERT INTO registration_requests (idempotency_key_hash, request_sha256) VALUES ($1, $2)",
        [keyHash, requestHash],
      ),
    ).rejects.toThrow(new RegExp(`registration_requests_${column}_32_bytes_check`, "iu"));
  });

  it("rejects duplicate idempotency digests even when requests differ", async () => {
    const keyHash = digest();
    await client.query(
      "INSERT INTO registration_requests (idempotency_key_hash, request_sha256) VALUES ($1, $2)",
      [keyHash, digest()],
    );
    await expect(
      client.query(
        "INSERT INTO registration_requests (idempotency_key_hash, request_sha256) VALUES ($1, $2)",
        [keyHash, digest()],
      ),
    ).rejects.toThrow(/registration_requests_idempotency_key_hash_key/iu);
  });

  it("rejects a two-tenant crossed result pair", async () => {
    const tenantA = await insertTenant("Result pair tenant A");
    const tenantB = await insertTenant("Result pair tenant B");
    const keyB = await insertKey(tenantB);
    await expect(
      client.query(
        `INSERT INTO registration_requests
           (idempotency_key_hash, request_sha256, status, tenant_id, api_key_id)
         VALUES ($1, $2, 'succeeded', $3, $4)`,
        [digest(), digest(), tenantA, keyB],
      ),
    ).rejects.toThrow(/registration_requests_result_api_key_tenant_fkey/iu);
  });

  it("rejects orphan results and restricts deletion of referenced tenant and key", async () => {
    const tenantId = await insertTenant("Restricted result tenant");
    const keyId = await insertKey(tenantId);
    await client.query(
      `INSERT INTO registration_requests
         (idempotency_key_hash, request_sha256, status, tenant_id, api_key_id)
       VALUES ($1, $2, 'succeeded', $3, $4)`,
      [digest(), digest(), tenantId, keyId],
    );
    await expect(client.query("DELETE FROM api_keys WHERE id = $1", [keyId])).rejects.toThrow(
      /registration_requests_(api_key_id|result_api_key_tenant)_fkey/iu,
    );
    await expect(client.query("DELETE FROM tenants WHERE id = $1", [tenantId])).rejects.toThrow(
      /registration_requests_tenant_id_fkey|api_keys_tenant_id_fkey/iu,
    );
    await expect(
      client.query(
        `INSERT INTO registration_requests
           (idempotency_key_hash, request_sha256, status, tenant_id, api_key_id)
         VALUES ($1, $2, 'succeeded', gen_random_uuid(), gen_random_uuid())`,
        [digest(), digest()],
      ),
    ).rejects.toThrow(/registration_requests_.*_fkey/iu);
  });

  it("updates updated_at on every mutation while preserving created_at", async () => {
    const id = await client.query<{ id: string }>(
      `INSERT INTO registration_requests (idempotency_key_hash, request_sha256)
       VALUES ($1, $2) RETURNING id`,
      [digest(), digest()],
    );
    const before = await client.query<{ created_at: Date; updated_at: Date }>(
      "SELECT created_at, updated_at FROM registration_requests WHERE id = $1",
      [id.rows[0]!.id],
    );
    await client.query("SELECT pg_sleep(0.02)");
    const after = await client.query<{ created_at: Date; updated_at: Date }>(
      `UPDATE registration_requests SET request_sha256 = $2, updated_at = '2000-01-01'
       WHERE id = $1 RETURNING created_at, updated_at`,
      [id.rows[0]!.id, digest()],
    );
    expect(after.rows[0]?.created_at).toEqual(before.rows[0]?.created_at);
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]!.updated_at.getTime(),
    );
  });
});
