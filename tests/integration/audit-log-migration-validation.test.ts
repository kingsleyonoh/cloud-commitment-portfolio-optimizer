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

async function insertUser(tenantId: string, label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, 'tenant_admin') RETURNING id`,
    [tenantId, `${label}@example.invalid`, label],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_audit_validation");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("audit actor attribution and safe values", () => {
  it("accepts a same-tenant user actor with polymorphic entity identity and JSON objects", async () => {
    const tenantId = await insertTenant("Audit user tenant");
    const userId = await insertUser(tenantId, "audit-user");
    const entityId = "751e54d8-13b4-4df7-ac82-68354f3b18c1";
    const result = await client.query<{
      actor_type: string;
      entity_id: string;
      old_values: Record<string, unknown>;
      new_values: Record<string, unknown>;
      timestamps_equal: boolean;
    }>(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
          old_values, new_values, request_id)
       VALUES ($1, $2, 'user', 'resource.changed', 'resource', $3,
               '{"state":"active"}', '{"state":"inactive"}', 'request-001')
       RETURNING actor_type, entity_id, old_values, new_values,
                 updated_at = created_at AS timestamps_equal`,
      [tenantId, userId, entityId],
    );
    expect(result.rows[0]).toEqual({
      actor_type: "user",
      entity_id: entityId,
      old_values: { state: "active" },
      new_values: { state: "inactive" },
      timestamps_equal: true,
    });
  });

  it.each(["api_key", "job", "system"])(
    "accepts a %s actor only without a user identity",
    async (actorType) => {
      const tenantId = await insertTenant(`Audit ${actorType} tenant`);
      const result = await client.query<{ actor_user_id: string | null }>(
        `INSERT INTO audit_log
           (tenant_id, actor_type, action, entity_type, entity_id, old_values, new_values)
         VALUES ($1, $2, 'resource.observed', 'resource', NULL, NULL, NULL)
         RETURNING actor_user_id`,
        [tenantId, actorType],
      );
      expect(result.rows[0]?.actor_user_id).toBeNull();
    },
  );

  it("rejects cross-tenant user attribution", async () => {
    const tenantA = await insertTenant("Audit attribution tenant A");
    const tenantB = await insertTenant("Audit attribution tenant B");
    const userB = await insertUser(tenantB, "audit-user-b");
    await expect(
      client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, actor_type, action, entity_type)
         VALUES ($1, $2, 'user', 'resource.changed', 'resource')`,
        [tenantA, userB],
      ),
    ).rejects.toThrow(/audit_log_tenant_actor_user_fkey/iu);
  });

  it.each([
    ["unknown actor", "operator", null, "audit_log_actor_type_check"],
    ["user without identity", "user", null, "audit_log_actor_user_coupling_check"],
    ["api key with user identity", "api_key", "user", "audit_log_actor_user_coupling_check"],
    ["job with user identity", "job", "user", "audit_log_actor_user_coupling_check"],
    ["system with user identity", "system", "user", "audit_log_actor_user_coupling_check"],
  ])("rejects %s", async (_label, actorType, actorMode, constraint) => {
    const tenantId = await insertTenant(`Invalid actor ${_label}`);
    const userId = actorMode === "user" ? await insertUser(tenantId, `invalid-${actorType}`) : null;
    await expect(
      client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, actor_type, action, entity_type)
         VALUES ($1, $2, $3, 'resource.changed', 'resource')`,
        [tenantId, userId, actorType],
      ),
    ).rejects.toThrow(new RegExp(String(constraint), "iu"));
  });

  it.each([
    ["action", "", "resource", null, "audit_log_action_trimmed_check"],
    ["action", " padded ", "resource", null, "audit_log_action_trimmed_check"],
    ["entity", "resource.changed", "   ", null, "audit_log_entity_type_trimmed_check"],
    ["entity", "resource.changed", " padded ", null, "audit_log_entity_type_trimmed_check"],
    ["request", "resource.changed", "resource", "", "audit_log_request_id_trimmed_check"],
    ["request", "resource.changed", "resource", " padded ", "audit_log_request_id_trimmed_check"],
  ])("rejects unsafe %s text", async (_label, action, entityType, requestId, constraint) => {
    const tenantId = await insertTenant(`Invalid text ${_label} tenant`);
    await expect(
      client.query(
        `INSERT INTO audit_log (tenant_id, actor_type, action, entity_type, request_id)
         VALUES ($1, 'system', $2, $3, $4)`,
        [tenantId, action, entityType, requestId],
      ),
    ).rejects.toThrow(new RegExp(String(constraint), "iu"));
  });

  it.each([
    ["old_values", "[]", "audit_log_old_values_object_check"],
    ["old_values", '"text"', "audit_log_old_values_object_check"],
    ["new_values", "1", "audit_log_new_values_object_check"],
    ["new_values", "true", "audit_log_new_values_object_check"],
  ])("rejects non-object %s JSON", async (column, value, constraint) => {
    const tenantId = await insertTenant(`Invalid JSON ${column} ${value}`);
    await expect(
      client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_type, action, entity_type, ${column})
         VALUES ($1, 'system', 'resource.changed', 'resource', $2::jsonb)`,
        [tenantId, value],
      ),
    ).rejects.toThrow(new RegExp(String(constraint), "iu"));
  });

  it("rejects unequal insert timestamps", async () => {
    const tenantId = await insertTenant("Invalid timestamp tenant");
    await expect(
      client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_type, action, entity_type, created_at, updated_at)
         VALUES ($1, 'system', 'resource.changed', 'resource', now(), now() + interval '1 second')`,
        [tenantId],
      ),
    ).rejects.toThrow(/audit_log_timestamps_equal_check/iu);
  });
});
