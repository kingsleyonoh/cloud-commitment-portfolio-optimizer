CREATE TABLE auth_refresh_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_refresh_families_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT auth_refresh_families_tenant_user_fkey
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT auth_refresh_families_absolute_expiry_check CHECK (
    absolute_expires_at > created_at
  ),
  CONSTRAINT auth_refresh_families_revocation_coupling_check CHECK (
    (revoked_at IS NULL) = (revocation_reason IS NULL)
  ),
  CONSTRAINT auth_refresh_families_revocation_reason_check CHECK (
    revocation_reason IN (
      'logout',
      'reuse_detected',
      'password_reset',
      'user_inactive',
      'tenant_inactive',
      'role_changed',
      'operator_revoked'
    )
  ),
  CONSTRAINT auth_refresh_families_revocation_chronology_check CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  CONSTRAINT auth_refresh_families_timestamps_ordered_check CHECK (
    updated_at >= created_at
  ),
  CONSTRAINT auth_refresh_families_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX auth_refresh_families_tenant_user_revoked_created_idx
ON auth_refresh_families (tenant_id, user_id, revoked_at, created_at DESC, id DESC);

CREATE INDEX auth_refresh_families_active_absolute_expiry_idx
ON auth_refresh_families (absolute_expires_at)
WHERE revoked_at IS NULL;

CREATE FUNCTION set_auth_refresh_families_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.absolute_expires_at IS DISTINCT FROM OLD.absolute_expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'family identity and lifetime are immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason) THEN
    RAISE EXCEPTION 'revocation is immutable' USING ERRCODE = '23514';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_refresh_families_set_updated_at
BEFORE UPDATE ON auth_refresh_families
FOR EACH ROW
EXECUTE FUNCTION set_auth_refresh_families_updated_at();
