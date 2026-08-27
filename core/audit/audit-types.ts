export type AuditActorType = "user" | "api_key" | "job" | "system";

export type AuditRecord = Readonly<{
  id: string;
  actorUserId: string | null;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}>;

export type Audit = Readonly<{
  id: string;
  actor_user_id: string | null;
  actor_type: AuditActorType;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}>;

export type AuditListInput = Readonly<{
  limit: number;
  action?: string;
  actorType?: AuditActorType;
  entityType?: string;
  entityId?: string;
  cursor?: { createdAt: string; id: string };
}>;
