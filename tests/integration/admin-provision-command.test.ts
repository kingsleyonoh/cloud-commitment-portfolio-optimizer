import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

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

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let pool: Pool | undefined;
const temporaryDirectories: string[] = [];

function passwordValue(): string {
  return Array.from({ length: 20 }, (_, index) => String.fromCodePoint(0x41 + (index % 23))).join(
    "",
  );
}

async function passwordFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-admin-provision-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "password");
  await writeFile(path, passwordValue(), { mode: 0o600 });
  return path;
}

async function fresh(prefix: string): Promise<{ tenantId: string; path: string }> {
  database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  pool = new Pool({ connectionString: database.url, max: 10 });
  const tenant = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ('Operator Tenant', 'Operator Tenant', 'Operator Tenant', 'Operator Tenant')
     RETURNING id`,
  );
  return { tenantId: tenant.rows[0]!.id, path: await passwordFile() };
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
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe.sequential("operator first-admin provisioning", () => {
  it("creates the exact first active admin, credential, and safe system audit in one transaction", async () => {
    const { tenantId, path } = await fresh("ccpo_operator_admin_create");
    const result = await provisionFirstAdmin({
      databaseUrl: database!.url,
      tenantId,
      email: " ADMIN@Example.Invalid ",
      name: " Admin Name ",
      passwordFile: path,
    });
    const state = await pool!.query<{
      email: string;
      name: string;
      role: string;
      isActive: boolean;
      auditSafe: boolean;
    }>(`SELECT u.email, u.name, u.role, u.is_active AS "isActive",
      a.actor_type = 'system' AND a.actor_user_id IS NULL
        AND a.action = 'user.admin_bootstrapped' AND a.entity_id = u.id
        AND a.old_values IS NULL
        AND a.new_values = '{"result":"succeeded","mode":"created"}'::jsonb AS "auditSafe"
      FROM users u JOIN audit_log a ON a.entity_id = u.id`);

    expect(result.mode).toBe("created");
    expect(state.rows[0]).toEqual({
      email: "admin@example.invalid",
      name: "Admin Name",
      role: "tenant_admin",
      isActive: true,
      auditSafe: true,
    });
    expect(await counts()).toEqual({ users: 1, credentials: 1, audits: 1 });
  });

  it("provisions only the one exact active credential-free admin", async () => {
    const { tenantId, path } = await fresh("ccpo_operator_admin_exact");
    const user = await pool!.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, 'exact@example.invalid', 'Exact Admin', 'tenant_admin') RETURNING id`,
      [tenantId],
    );
    const result = await provisionFirstAdmin({
      databaseUrl: database!.url,
      tenantId,
      email: "exact@example.invalid",
      name: "Exact Admin",
      passwordFile: path,
    });
    const audit = await pool!.query<{ mode: string }>(
      "SELECT new_values->>'mode' AS mode FROM audit_log WHERE entity_id = $1",
      [user.rows[0]!.id],
    );

    expect(result.mode).toBe("exact_provisioned");
    expect(audit.rows[0]!.mode).toBe("exact_provisioned");
    expect(await counts()).toEqual({ users: 1, credentials: 1, audits: 1 });
    await expect(
      provisionFirstAdmin({
        databaseUrl: database!.url,
        tenantId,
        email: "exact@example.invalid",
        name: "Exact Admin",
        passwordFile: path,
      }),
    ).rejects.toBeInstanceOf(AdminProvisioningError);
    expect(await counts()).toEqual({ users: 1, credentials: 1, audits: 1 });
  });

  it("fails before writes for mismatching, multiple, inactive, or already provisioned admins", async () => {
    const { tenantId, path } = await fresh("ccpo_operator_admin_ambiguous");
    await pool!.query(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, 'existing@example.invalid', 'Existing Admin', 'tenant_admin')`,
      [tenantId],
    );
    await expect(
      provisionFirstAdmin({
        databaseUrl: database!.url,
        tenantId,
        email: "different@example.invalid",
        name: "Different Admin",
        passwordFile: path,
      }),
    ).rejects.toBeInstanceOf(AdminProvisioningError);
    expect(await counts()).toEqual({ users: 1, credentials: 0, audits: 0 });

    await pool!.query(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, 'second@example.invalid', 'Second Admin', 'tenant_admin')`,
      [tenantId],
    );
    await expect(
      provisionFirstAdmin({
        databaseUrl: database!.url,
        tenantId,
        email: "existing@example.invalid",
        name: "Existing Admin",
        passwordFile: path,
      }),
    ).rejects.toBeInstanceOf(AdminProvisioningError);
    expect(await counts()).toEqual({ users: 2, credentials: 0, audits: 0 });
  });

  it("serializes concurrent operator attempts to one credential and one audit", async () => {
    const { tenantId, path } = await fresh("ccpo_operator_admin_race");
    const input = {
      databaseUrl: database!.url,
      tenantId,
      email: "race@example.invalid",
      name: "Race Admin",
      passwordFile: path,
    };
    const results = await Promise.allSettled([
      provisionFirstAdmin(input),
      provisionFirstAdmin(input),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await counts()).toEqual({ users: 1, credentials: 1, audits: 1 });
  });

  it("actual npm command emits only a generic success with no credential material", async () => {
    const { tenantId, path } = await fresh("ccpo_operator_admin_cli");
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("npm_execpath is required.");
    const child = spawn(
      process.execPath,
      [
        npmCli,
        "run",
        "--silent",
        "auth:provision-admin",
        "--",
        "--tenant-id",
        tenantId,
        "--email",
        "cli@example.invalid",
        "--name",
        "CLI Admin",
        "--password-file",
        path,
      ],
      {
        env: { ...process.env, NODE_ENV: "test", DATABASE_URL: database!.url },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const exitCode = await new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    const output = Buffer.concat(stdout).toString("utf8");
    const errors = Buffer.concat(stderr).toString("utf8");

    expect(exitCode).toBe(0);
    expect(output.trim()).toBe("Administrator credential provisioned.");
    expect(output.includes(passwordValue())).toBe(false);
    expect(output.includes("$argon2")).toBe(false);
    expect(errors).toBe("");
  });
});
