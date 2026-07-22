import { Client } from "pg";

export interface IsolatedDatabase {
  name: string;
  url: string;
}

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;

export function requireAdminDatabaseUrl(): string {
  if (!adminDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required; point it at an isolated local PostgreSQL 16 admin database.",
    );
  }
  return adminDatabaseUrl;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function createIsolatedDatabase(prefix: string): Promise<IsolatedDatabase> {
  const adminUrl = requireAdminDatabaseUrl();
  const name = `${prefix}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const version = await admin.query<{ server_version: string }>("SHOW server_version");
    if (!version.rows[0]?.server_version.startsWith("16.")) {
      throw new Error(
        `PostgreSQL 16 required; received ${version.rows[0]?.server_version ?? "unknown"}.`,
      );
    }
    await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${name}`;
  return { name, url: parsed.toString() };
}

export async function dropIsolatedDatabase(database?: IsolatedDatabase): Promise<void> {
  if (!database) return;
  const admin = new Client({ connectionString: requireAdminDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [database.name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database.name)}`);
  } finally {
    await admin.end();
  }
}
