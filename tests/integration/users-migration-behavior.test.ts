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
const roles = ["tenant_admin", "finops_analyst", "finance_approver", "read_only_auditor"] as const;
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

async function insertUser(tenantId: string, email: string, role = "tenant_admin") {
  return client.query<{ id: string; is_active: boolean; created_at: Date; updated_at: Date }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, $4) RETURNING id, is_active, created_at, updated_at`,
    [tenantId, email, `Name ${email}`, role],
  );
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_users_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("users identity, roles, and defaults", () => {
  it("generates UUID, active, and ordered timestamp defaults", async () => {
    const tenantId = await insertTenant("Users defaults tenant");
    const user = (await insertUser(tenantId, "defaults@example.test")).rows[0]!;

    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
    expect(user.is_active).toBe(true);
    expect(user.created_at).toBeInstanceOf(Date);
    expect(user.updated_at.getTime()).toBeGreaterThanOrEqual(user.created_at.getTime());
  });

  it.each(roles)("accepts the canonical %s role", async (role) => {
    const tenantId = await insertTenant(`Role ${role}`);
    await expect(insertUser(tenantId, `${role}@example.test`, role)).resolves.toBeDefined();
  });

  it("requires a role with no default and rejects values outside the four roles", async () => {
    const tenantId = await insertTenant("Role rejection tenant");
    await expect(
      client.query("INSERT INTO users (tenant_id, email, name) VALUES ($1, $2, $3)", [
        tenantId,
        "missing-role@example.test",
        "Missing Role",
      ]),
    ).rejects.toThrow(/null value.*role/iu);
    await expect(insertUser(tenantId, "owner@example.test", "owner")).rejects.toThrow(
      /users_role_check/iu,
    );
  });
});

describe("users canonical fields and tenant ownership", () => {
  it.each([
    "",
    " padded@example.test ",
    "MixedCase@example.test",
    "upper@EXAMPLE.TEST",
    "no-at",
    "two@@example.test",
    "space @example.test",
  ])("rejects noncanonical email %j", async (email) => {
    const tenantId = await insertTenant(`Invalid email ${JSON.stringify(email)}`);
    await expect(insertUser(tenantId, email)).rejects.toThrow(/users_email_canonical_check/iu);
  });

  it.each(["", "   ", " Padded Name "])("rejects blank or padded name %j", async (name) => {
    const tenantId = await insertTenant(`Invalid name ${JSON.stringify(name)}`);
    await expect(
      client.query("INSERT INTO users (tenant_id, email, name, role) VALUES ($1, $2, $3, $4)", [
        tenantId,
        `name-${Math.random()}@example.test`,
        name,
        "tenant_admin",
      ]),
    ).rejects.toThrow(/users_name_trimmed_check/iu);
  });

  it("rejects the same canonical email within one tenant but allows it across tenants", async () => {
    const firstTenantId = await insertTenant("Canonical email tenant A");
    const secondTenantId = await insertTenant("Canonical email tenant B");
    await insertUser(firstTenantId, "shared@example.test");

    await expect(insertUser(firstTenantId, "shared@example.test")).rejects.toThrow(
      /users_tenant_email_key/iu,
    );
    await expect(insertUser(secondTenantId, "shared@example.test")).resolves.toBeDefined();
  });

  it("enforces the tenant foreign key and restricts deletion of an owning tenant", async () => {
    const tenantId = await insertTenant("Restricted tenant");
    await insertUser(tenantId, "retained@example.test");
    await expect(
      insertUser("00000000-0000-0000-0000-000000000000", "orphan@example.test"),
    ).rejects.toThrow(/users_tenant_id_fkey/iu);
    await expect(client.query("DELETE FROM tenants WHERE id = $1", [tenantId])).rejects.toThrow(
      /users_tenant_id_fkey/iu,
    );
  });

  it("tenant-leading list and point queries exclude every other tenant literal", async () => {
    const firstTenantId = await insertTenant("Query tenant A literal");
    const secondTenantId = await insertTenant("Query tenant B literal");
    const first = await insertUser(firstTenantId, "query-a@example.test", "finops_analyst");
    await client.query("INSERT INTO users (tenant_id, email, name, role) VALUES ($1, $2, $3, $4)", [
      secondTenantId,
      "query-b@example.test",
      "Other Tenant Literal",
      "finops_analyst",
    ]);
    const list = await client.query<{ id: string; email: string; name: string }>(
      `SELECT id, email, name FROM users
       WHERE tenant_id = $1 AND role = $2 AND is_active = true ORDER BY email, id`,
      [firstTenantId, "finops_analyst"],
    );
    const point = await client.query<{ email: string }>(
      "SELECT email FROM users WHERE tenant_id = $1 AND id = $2",
      [secondTenantId, first.rows[0]!.id],
    );

    expect(list.rows).toEqual([
      { id: first.rows[0]!.id, email: "query-a@example.test", name: "Name query-a@example.test" },
    ]);
    expect(JSON.stringify(list.rows)).not.toContain("query-b@example.test");
    expect(JSON.stringify(list.rows)).not.toContain("Other Tenant Literal");
    expect(point.rows).toEqual([]);
  });
});

describe("users database-managed timestamps", () => {
  it("advances updated_at while preserving created_at", async () => {
    const tenantId = await insertTenant("User timestamp tenant");
    const before = (await insertUser(tenantId, "timestamp@example.test")).rows[0]!;
    await client.query("SELECT pg_sleep(0.02)");
    const updated = await client.query<{ created_at: Date; updated_at: Date }>(
      `UPDATE users SET is_active = false WHERE tenant_id = $1 AND id = $2
       RETURNING created_at, updated_at`,
      [tenantId, before.id],
    );

    expect(updated.rows[0]?.created_at).toEqual(before.created_at);
    expect(updated.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  it("rejects an initially reversed timestamp order", async () => {
    const tenantId = await insertTenant("User timestamp rejection tenant");
    await expect(
      client.query(
        `INSERT INTO users (tenant_id, email, name, role, created_at, updated_at)
         VALUES ($1, 'reversed@example.test', 'Reversed', 'tenant_admin',
                 '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [tenantId],
      ),
    ).rejects.toThrow(/users_timestamps_ordered_check/iu);
  });
});
