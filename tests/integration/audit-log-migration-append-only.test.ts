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

async function insertAudit(tenantId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO audit_log (tenant_id, actor_type, action, entity_type)
     VALUES ($1, 'system', 'resource.created', 'resource') RETURNING id`,
    [tenantId],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_audit_append_only");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("ordinary audit mutations are rejected", () => {
  it("rejects UPDATE and preserves the original row", async () => {
    const tenantId = await insertTenant("Append-only update tenant");
    const auditId = await insertAudit(tenantId);
    await expect(
      client.query("UPDATE audit_log SET action = 'resource.changed' WHERE id = $1", [auditId]),
    ).rejects.toThrow(/audit_log is append-only/iu);
    const result = await client.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE id = $1",
      [auditId],
    );
    expect(result.rows).toEqual([{ action: "resource.created" }]);
  });

  it("rejects DELETE and preserves the original row", async () => {
    const tenantId = await insertTenant("Append-only delete tenant");
    const auditId = await insertAudit(tenantId);
    await expect(client.query("DELETE FROM audit_log WHERE id = $1", [auditId])).rejects.toThrow(
      /audit_log is append-only/iu,
    );
    const result = await client.query<{ count: string }>(
      "SELECT count(*) FROM audit_log WHERE id = $1",
      [auditId],
    );
    expect(result.rows[0]?.count).toBe("1");
  });

  it("restricts deletion of a tenant referenced only by an audit row", async () => {
    const tenantId = await insertTenant("Audit tenant restriction");
    await insertAudit(tenantId);
    await expect(client.query("DELETE FROM tenants WHERE id = $1", [tenantId])).rejects.toThrow(
      /audit_log_tenant_id_fkey/iu,
    );
  });

  it("restricts deletion of a same-tenant user actor", async () => {
    const tenantId = await insertTenant("Audit user restriction");
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, 'restricted-user@example.invalid', 'Restricted user', 'tenant_admin')
       RETURNING id`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type)
       VALUES ($1, $2, 'user', 'resource.changed', 'resource')`,
      [tenantId, user.rows[0]!.id],
    );
    await expect(
      client.query("DELETE FROM users WHERE id = $1", [user.rows[0]!.id]),
    ).rejects.toThrow(/audit_log_tenant_actor_user_fkey/iu);
  });

  it("keeps tenant-leading indexes usable for isolated action, actor, and entity queries", async () => {
    const tenantA = await insertTenant("Audit query tenant A");
    const tenantB = await insertTenant("Audit query tenant B");
    const users = await client.query<{ id: string; tenant_id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, 'query-a@example.invalid', 'Query A', 'tenant_admin'),
              ($2, 'query-b@example.invalid', 'Query B', 'tenant_admin')
       RETURNING id, tenant_id`,
      [tenantA, tenantB],
    );
    const userA = users.rows.find(({ tenant_id }) => tenant_id === tenantA)!.id;
    const userB = users.rows.find(({ tenant_id }) => tenant_id === tenantB)!.id;
    const entityId = "c96cfbd8-a0fc-46fe-843a-28838c4217bb";
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id)
       VALUES ($1, $3, 'user', 'resource.read', 'resource', $5),
              ($2, $4, 'user', 'resource.read', 'resource', $5)`,
      [tenantA, tenantB, userA, userB, entityId],
    );
    const byAction = await client.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM audit_log WHERE tenant_id = $1 AND action = 'resource.read'",
      [tenantA],
    );
    const byActor = await client.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM audit_log WHERE tenant_id = $1 AND actor_user_id = $2",
      [tenantA, userA],
    );
    const byEntity = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM audit_log
       WHERE tenant_id = $1 AND entity_type = 'resource' AND entity_id = $2`,
      [tenantA, entityId],
    );
    expect([byAction.rows, byActor.rows, byEntity.rows]).toEqual([
      [{ tenant_id: tenantA }],
      [{ tenant_id: tenantA }],
      [{ tenant_id: tenantA }],
    ]);
  });
});
