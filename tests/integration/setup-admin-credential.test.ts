import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import { runSetup } from "../../core/db/setup.js";
import { FirstRunInitializationError } from "../../core/tenant/initialization.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let pool: Pool | undefined;
const temporaryDirectories: string[] = [];

function passwordValue(): string {
  return Array.from({ length: 18 }, (_, index) => String.fromCodePoint(0x61 + (index % 24))).join(
    "",
  );
}

async function passwordFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-setup-admin-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "password");
  await writeFile(path, `${passwordValue()}\r\n`, { mode: 0o600 });
  return path;
}

function options(path: string, admin = true) {
  return {
    databaseUrl: database!.url,
    migrationsDirectory,
    tenant: {
      defaultTenantName: "Credential Setup Tenant",
      defaultAdminEmail: admin ? "admin@example.invalid" : "",
      defaultAdminName: admin ? "Admin User" : "",
      defaultAdminPasswordFile: admin ? path : "",
      apiKeyPrefix: "ccpo",
    },
  };
}

afterEach(async () => {
  await pool?.end();
  pool = undefined;
  await dropIsolatedDatabase(database);
  database = undefined;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe.sequential("fresh setup administrator credential", () => {
  it("commits tenant, admin metadata, credential, key, and secret-free system audit atomically", async () => {
    database = await createIsolatedDatabase("ccpo_setup_admin_credential");
    const path = await passwordFile();
    pool = new Pool({ connectionString: database.url });
    const first = await runSetup(options(path));
    const second = await runSetup(options(path));
    const result = await pool.query<{
      tenants: number;
      users: number;
      credentials: number;
      keys: number;
      audits: number;
      auditSafe: boolean;
      policyShape: boolean;
    }>(`SELECT
      (SELECT count(*)::int FROM tenants) AS tenants,
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM user_auth_credentials) AS credentials,
      (SELECT count(*)::int FROM api_keys) AS keys,
      (SELECT count(*)::int FROM audit_log) AS audits,
      (SELECT actor_type = 'system' AND actor_user_id IS NULL
        AND action = 'user.admin_bootstrapped' AND entity_type = 'user'
        AND old_values IS NULL AND new_values = '{"result":"succeeded","mode":"created"}'::jsonb
        AND request_id IS NULL FROM audit_log) AS "auditSafe",
      (SELECT password_hash LIKE '$argon2id$v=19$m=65536,t=3,p=1$%'
        AND octet_length(password_hash) <= 512 FROM user_auth_credentials) AS "policyShape"`);

    expect(first.initialization.created).toBe(true);
    expect(second.initialization.created).toBe(false);
    expect(result.rows[0]).toEqual({
      tenants: 1,
      users: 1,
      credentials: 1,
      keys: 1,
      audits: 1,
      auditSafe: true,
      policyShape: true,
    });
  });

  it("rolls the complete fresh state back when the system audit cannot commit", async () => {
    database = await createIsolatedDatabase("ccpo_setup_admin_audit_rollback");
    const path = await passwordFile();
    pool = new Pool({ connectionString: database.url });
    await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    await pool.query(`CREATE FUNCTION fail_setup_admin_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action = 'user.admin_bootstrapped' THEN RAISE EXCEPTION 'injected'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER fail_setup_admin_audit_trigger
      BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_setup_admin_audit()`);

    await expect(runSetup(options(path))).rejects.toBeInstanceOf(FirstRunInitializationError);
    const counts = await pool.query<{ tenants: number; users: number; credentials: number }>(
      `SELECT (SELECT count(*)::int FROM tenants) AS tenants,
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM user_auth_credentials) AS credentials`,
    );
    expect(counts.rows[0]).toEqual({ tenants: 0, users: 0, credentials: 0 });
  });

  it("does not retrofit an initialized legacy credential-free admin", async () => {
    database = await createIsolatedDatabase("ccpo_setup_legacy_admin");
    const path = await passwordFile();
    pool = new Pool({ connectionString: database.url });
    const initial = await runSetup(options(path, false));
    await pool.query(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, 'admin@example.invalid', 'Admin User', 'tenant_admin')`,
      [initial.initialization.tenantId],
    );

    await expect(runSetup(options(path))).rejects.toMatchObject({
      code: "INITIALIZATION_STATE_AMBIGUOUS",
    });
    const credentials = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM user_auth_credentials",
    );
    expect(credentials.rows[0]!.count).toBe(0);
  });
});
