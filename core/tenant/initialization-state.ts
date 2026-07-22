import type { Client, PoolClient } from "pg";

export interface FirstRunStateCounts {
  tenantCount: number;
  userCount: number;
  keyCount: number;
  markerCount: number;
  registrationCount: number;
  succeededRegistrationCount: number;
}

export async function readFirstRunState(
  client: PoolClient | Client,
  markerNote: string,
): Promise<FirstRunStateCounts> {
  const result = await client.query<FirstRunStateCounts>(
    `SELECT
      (SELECT count(*)::int FROM tenants) AS "tenantCount",
      (SELECT count(*)::int FROM users) AS "userCount",
      (SELECT count(*)::int FROM api_keys) AS "keyCount",
      (SELECT count(*)::int FROM api_keys WHERE note = $1) AS "markerCount",
      (SELECT count(*)::int FROM registration_requests) AS "registrationCount",
      (SELECT count(*)::int FROM registration_requests r
        JOIN tenants t ON t.id = r.tenant_id
        JOIN api_keys k ON k.id = r.api_key_id AND k.tenant_id = t.id
        WHERE r.status = 'succeeded') AS "succeededRegistrationCount"`,
    [markerNote],
  );
  const row = result.rows[0];
  if (!row) throw new Error("First-run state query returned no row.");
  return row;
}

export function isFreshFirstRunState(counts: FirstRunStateCounts): boolean {
  return Object.values(counts).every((count) => count === 0);
}
