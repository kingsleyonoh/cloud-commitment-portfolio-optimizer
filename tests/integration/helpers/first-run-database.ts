import { Client } from "pg";

export interface SafeFirstRunSnapshot {
  tenantCount: number;
  userCount: number;
  keyCount: number;
  markerCount: number;
  activeMarkerCount: number;
  hashShapeCount: number;
}

export async function safeFirstRunSnapshot(databaseUrl: string): Promise<SafeFirstRunSnapshot> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<SafeFirstRunSnapshot>(`
      SELECT
        (SELECT count(*)::int FROM tenants) AS "tenantCount",
        (SELECT count(*)::int FROM users) AS "userCount",
        (SELECT count(*)::int FROM api_keys) AS "keyCount",
        (SELECT count(*)::int FROM api_keys WHERE note = 'system:first-run:v1') AS "markerCount",
        (SELECT count(*)::int FROM api_keys
          WHERE note = 'system:first-run:v1' AND revoked_at IS NULL) AS "activeMarkerCount",
        (SELECT count(*)::int FROM api_keys WHERE key_hash ~ '^[0-9a-f]{64}$') AS "hashShapeCount"
    `);
    const snapshot = result.rows[0];
    if (!snapshot) throw new Error("First-run snapshot query returned no row.");
    return snapshot;
  } finally {
    await client.end();
  }
}

export async function queryOne<T extends object>(databaseUrl: string, sql: string): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<T>(sql);
    const row = result.rows[0];
    if (!row) throw new Error("Expected one database row.");
    return row;
  } finally {
    await client.end();
  }
}
