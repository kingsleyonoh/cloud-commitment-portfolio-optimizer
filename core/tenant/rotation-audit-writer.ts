import type { PoolClient } from "pg";

export interface RotationAuditInput {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  oldKey: { id: string; createdAt: string };
  revokedAt: string;
  replacement: { id: string; createdAt: string };
}

export async function insertRotationAudit(
  client: PoolClient,
  input: RotationAuditInput,
): Promise<string> {
  const oldValues = {
    created_at: input.oldKey.createdAt,
    revoked_at: null,
  };
  const newValues = {
    result: "succeeded",
    revoked_at: input.revokedAt,
    replacement: {
      id: input.replacement.id,
      created_at: input.replacement.createdAt,
      revoked_at: null,
    },
  };
  const result = await client.query<{ id: string }>(
    `INSERT INTO audit_log
      (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
       old_values, new_values, request_id)
     VALUES ($1, $2, 'user', 'api_key.rotated', 'api_key', $3, $4::jsonb, $5::jsonb, $6)
     RETURNING id`,
    [
      input.tenantId,
      input.actorUserId,
      input.oldKey.id,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      input.requestId,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id || result.rowCount !== 1) throw new Error("Rotation audit insert returned no row.");
  return id;
}
