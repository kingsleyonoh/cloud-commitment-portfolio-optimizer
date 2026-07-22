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
let digestByte = 1;

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
  database = await createIsolatedDatabase("ccpo_registration_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("registration request legal states", () => {
  it("defaults to a pending digest-only request", async () => {
    const result = await client.query<{
      status: string;
      tenant_id: string | null;
      api_key_id: string | null;
      error_code: string | null;
    }>(
      `INSERT INTO registration_requests (idempotency_key_hash, request_sha256)
       VALUES ($1, $2) RETURNING status, tenant_id, api_key_id, error_code`,
      [digest(), digest()],
    );
    expect(result.rows[0]).toEqual({
      status: "pending",
      tenant_id: null,
      api_key_id: null,
      error_code: null,
    });
  });

  it("accepts succeeded only with a same-tenant result pair", async () => {
    const tenantId = await insertTenant("Succeeded pair tenant");
    const apiKeyId = await insertKey(tenantId);
    const result = await client.query<{ status: string }>(
      `INSERT INTO registration_requests
         (idempotency_key_hash, request_sha256, status, tenant_id, api_key_id)
       VALUES ($1, $2, 'succeeded', $3, $4) RETURNING status`,
      [digest(), digest(), tenantId, apiKeyId],
    );
    expect(result.rows[0]?.status).toBe("succeeded");
  });

  it("accepts failed only with a trimmed nonblank safe error code", async () => {
    const result = await client.query<{ error_code: string }>(
      `INSERT INTO registration_requests
         (idempotency_key_hash, request_sha256, status, error_code)
       VALUES ($1, $2, 'failed', 'registration_rejected') RETURNING error_code`,
      [digest(), digest()],
    );
    expect(result.rows[0]?.error_code).toBe("registration_rejected");
  });

  it.each([
    [
      "pending with tenant",
      "pending",
      true,
      false,
      null,
      "registration_requests_pending_state_check",
    ],
    [
      "pending with error",
      "pending",
      false,
      false,
      "blocked",
      "registration_requests_pending_state_check",
    ],
    [
      "succeeded without key",
      "succeeded",
      true,
      false,
      null,
      "registration_requests_succeeded_state_check",
    ],
    [
      "succeeded with error",
      "succeeded",
      true,
      true,
      "blocked",
      "registration_requests_succeeded_state_check",
    ],
    [
      "failed without error",
      "failed",
      false,
      false,
      null,
      "registration_requests_failed_state_check",
    ],
    [
      "failed with result",
      "failed",
      true,
      true,
      "blocked",
      "registration_requests_failed_state_check",
    ],
  ])("rejects %s", async (_label, status, hasTenant, hasKey, errorCode, constraint) => {
    const tenantId = await insertTenant(`Illegal state ${_label}`);
    const apiKeyId = await insertKey(tenantId);
    await expect(
      client.query(
        `INSERT INTO registration_requests
           (idempotency_key_hash, request_sha256, status, tenant_id, api_key_id, error_code)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          digest(),
          digest(),
          status,
          hasTenant ? tenantId : null,
          hasKey ? apiKeyId : null,
          errorCode,
        ],
      ),
    ).rejects.toThrow(new RegExp(String(constraint), "iu"));
  });

  it.each(["", "   ", " padded_code "])("rejects unsafe error code %j", async (errorCode) => {
    await expect(
      client.query(
        `INSERT INTO registration_requests
           (idempotency_key_hash, request_sha256, status, error_code)
         VALUES ($1, $2, 'failed', $3)`,
        [digest(), digest(), errorCode],
      ),
    ).rejects.toThrow(/registration_requests_(error_code_trimmed|failed_state)_check/iu);
  });
});
