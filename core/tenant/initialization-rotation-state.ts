import type { Client } from "pg";

import type {
  InitializationAuditRow,
  InitializationKeyRow,
  InitializationOrigin,
  InitializationRotationState,
} from "./initialization-rotation-chain.js";

interface OriginRow extends InitializationOrigin {
  source: "marker" | "registration";
}

export async function readInitializationRotationState(
  client: Client,
  markerNote: string,
): Promise<InitializationRotationState & { markerKeyId: string }> {
  const originResult = await client.query<OriginRow>(
    `SELECT id AS "keyId", tenant_id AS "tenantId", 'marker'::text AS source
     FROM api_keys WHERE note = $1
     UNION ALL
     SELECT api_key_id AS "keyId", tenant_id AS "tenantId", 'registration'::text AS source
     FROM registration_requests WHERE status = 'succeeded'`,
    [markerNote],
  );
  const keyResult = await client.query<InitializationKeyRow>(
    `SELECT id, tenant_id AS "tenantId", key_hash AS "keyHash",
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
      CASE WHEN revoked_at IS NULL THEN NULL
        ELSE to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      END AS "revokedAt"
     FROM api_keys`,
  );
  const auditResult = await client.query<InitializationAuditRow>(
    `SELECT a.tenant_id AS "tenantId", a.actor_user_id AS "actorUserId",
      u.tenant_id AS "actorTenantId", a.actor_type AS "actorType", a.action,
      a.entity_type AS "entityType", a.entity_id AS "entityId",
      a.request_id AS "requestId",
      to_char(a.created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
      a.old_values AS "oldValues", a.new_values AS "newValues"
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.action = 'api_key.rotated'`,
  );
  return {
    markerKeyId: markerKeyId(originResult.rows),
    origins: originResult.rows.map(({ keyId, tenantId }) => ({ keyId, tenantId })),
    keys: keyResult.rows,
    audits: auditResult.rows,
  };
}

function markerKeyId(origins: OriginRow[]): string {
  const markers = origins.filter((row) => row.source === "marker");
  if (markers.length !== 1) throw new Error("Initialization marker is ambiguous.");
  return markers[0]!.keyId;
}
