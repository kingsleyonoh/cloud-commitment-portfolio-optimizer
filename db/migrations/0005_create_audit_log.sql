CREATE UNIQUE INDEX users_tenant_id_id_key
ON users (tenant_id, id);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  actor_user_id UUID DEFAULT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID DEFAULT NULL,
  old_values JSONB DEFAULT NULL,
  new_values JSONB DEFAULT NULL,
  request_id TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT audit_log_tenant_actor_user_fkey
    FOREIGN KEY (tenant_id, actor_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT audit_log_actor_type_check CHECK (
    actor_type IN ('user', 'api_key', 'job', 'system')
  ),
  CONSTRAINT audit_log_actor_user_coupling_check CHECK (
    (actor_type = 'user' AND actor_user_id IS NOT NULL)
    OR (actor_type <> 'user' AND actor_user_id IS NULL)
  ),
  CONSTRAINT audit_log_action_trimmed_check CHECK (
    action = btrim(action) AND action <> ''
  ),
  CONSTRAINT audit_log_entity_type_trimmed_check CHECK (
    entity_type = btrim(entity_type) AND entity_type <> ''
  ),
  CONSTRAINT audit_log_request_id_trimmed_check CHECK (
    request_id IS NULL OR (request_id = btrim(request_id) AND request_id <> '')
  ),
  CONSTRAINT audit_log_old_values_object_check CHECK (
    old_values IS NULL OR jsonb_typeof(old_values) = 'object'
  ),
  CONSTRAINT audit_log_new_values_object_check CHECK (
    new_values IS NULL OR jsonb_typeof(new_values) = 'object'
  ),
  CONSTRAINT audit_log_timestamps_equal_check CHECK (updated_at = created_at)
);

CREATE INDEX audit_log_tenant_entity_created_idx
ON audit_log (tenant_id, entity_type, entity_id, created_at);

CREATE INDEX audit_log_tenant_actor_created_idx
ON audit_log (tenant_id, actor_user_id, created_at);

CREATE INDEX audit_log_tenant_action_created_idx
ON audit_log (tenant_id, action, created_at);

CREATE FUNCTION reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_log_append_only_trigger
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION reject_audit_log_mutation();
