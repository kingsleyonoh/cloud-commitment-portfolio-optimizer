import type { PoolClient } from "pg";

export async function insertLoginSuccessAudit(
  client: PoolClient,
  input: { tenantId: string; userId: string; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
      (tenant_id,actor_user_id,actor_type,action,entity_type,entity_id,
       old_values,new_values,request_id)
     VALUES ($1,$2,'user','user.login.succeeded','user',$2,NULL,
       '{"result":"succeeded"}'::jsonb,$3)`,
    [input.tenantId, input.userId, input.requestId],
  );
}

export async function insertLoginDeniedAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    userId: string;
    reason: "user_inactive" | "tenant_inactive";
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
      (tenant_id,actor_user_id,actor_type,action,entity_type,entity_id,
       old_values,new_values,request_id)
     VALUES ($1,$2,'user','user.login.denied','user',$2,NULL,
       jsonb_build_object('result','denied','reason',$3::text),$4)`,
    [input.tenantId, input.userId, input.reason, input.requestId],
  );
}

export async function insertRefreshReuseAudit(
  client: PoolClient,
  input: { tenantId: string; userId: string; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
      (tenant_id,actor_user_id,actor_type,action,entity_type,entity_id,
       old_values,new_values,request_id)
     VALUES ($1,NULL,'system','user.login.refresh_reuse_detected','user',$2,NULL,
       '{"result":"family_revoked","reason":"reuse_detected"}'::jsonb,$3)`,
    [input.tenantId, input.userId, input.requestId],
  );
}

export async function insertLogoutAudit(
  client: PoolClient,
  input: { tenantId: string; userId: string; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
      (tenant_id,actor_user_id,actor_type,action,entity_type,entity_id,
       old_values,new_values,request_id)
     VALUES ($1,$2,'user','user.logout.succeeded','user',$2,NULL,
       '{"result":"succeeded","family_revoked":true}'::jsonb,$3)`,
    [input.tenantId, input.userId, input.requestId],
  );
}
