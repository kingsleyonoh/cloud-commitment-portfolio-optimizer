import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";
import { afterEach, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  AdminProvisioningError,
  provisionFirstAdmin,
} from "../../core/tenant/admin-provisioning.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

let database: IsolatedDatabase | undefined;
let pool: Pool | undefined;
let directory: string | undefined;

async function fresh(prefix: string, active = true) {
  database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  pool = new Pool({ connectionString: database.url });
  const tenant = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name, is_active)
     VALUES ('Safety Tenant', 'Safety Tenant', 'Safety Tenant', 'Safety Tenant', $1) RETURNING id`,
    [active],
  );
  directory = await mkdtemp(join(tmpdir(), "ccpo-admin-safety-"));
  const passwordFile = join(directory, "password");
  const value = Array.from({ length: 18 }, (_, index) =>
    String.fromCodePoint(0x61 + (index % 24)),
  ).join("");
  await writeFile(passwordFile, value, { mode: 0o600 });
  return { tenantId: tenant.rows[0]!.id, passwordFile };
}

function input(tenantId: string, passwordFile: string) {
  return {
    databaseUrl: database!.url,
    tenantId,
    email: "safety@example.invalid",
    name: "Safety Admin",
    passwordFile,
  };
}

async function counts() {
  const result = await pool!.query<{ users: number; credentials: number; audits: number }>(
    `SELECT (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM user_auth_credentials) AS credentials,
      (SELECT count(*)::int FROM audit_log) AS audits`,
  );
  return result.rows[0];
}

afterEach(async () => {
  await pool?.end();
  pool = undefined;
  await dropIsolatedDatabase(database);
  database = undefined;
  if (directory) await rm(directory, { recursive: true });
  directory = undefined;
});

it("rejects an inactive explicit tenant before any administrator write", async () => {
  const { tenantId, passwordFile } = await fresh("ccpo_admin_inactive_tenant", false);
  await expect(provisionFirstAdmin(input(tenantId, passwordFile))).rejects.toBeInstanceOf(
    AdminProvisioningError,
  );
  expect(await counts()).toEqual({ users: 0, credentials: 0, audits: 0 });
});

it("rejects an inactive existing administrator as an ambiguous target", async () => {
  const { tenantId, passwordFile } = await fresh("ccpo_admin_inactive_target");
  await pool!.query(
    `INSERT INTO users (tenant_id, email, name, role, is_active)
     VALUES ($1, 'safety@example.invalid', 'Safety Admin', 'tenant_admin', false)`,
    [tenantId],
  );

  await expect(provisionFirstAdmin(input(tenantId, passwordFile))).rejects.toBeInstanceOf(
    AdminProvisioningError,
  );
  expect(await counts()).toEqual({ users: 1, credentials: 0, audits: 0 });
});

it("rolls back created admin and credential when the system audit fails", async () => {
  const { tenantId, passwordFile } = await fresh("ccpo_admin_audit_rollback");
  await pool!.query(`CREATE FUNCTION fail_operator_audit() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'user.admin_bootstrapped' THEN RAISE EXCEPTION 'injected'; END IF;
      RETURN NEW;
    END $$`);
  await pool!.query(`CREATE TRIGGER fail_operator_audit_trigger
    BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_operator_audit()`);

  await expect(provisionFirstAdmin(input(tenantId, passwordFile))).rejects.toBeInstanceOf(
    AdminProvisioningError,
  );
  expect(await counts()).toEqual({ users: 0, credentials: 0, audits: 0 });
});
