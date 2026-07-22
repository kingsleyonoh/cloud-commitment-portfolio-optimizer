CREATE TABLE auth_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  family_id UUID NOT NULL,
  parent_token_id UUID,
  token_digest BYTEA NOT NULL,
  csrf_digest BYTEA NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_refresh_tokens_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT auth_refresh_tokens_tenant_family_fkey
    FOREIGN KEY (tenant_id, family_id)
    REFERENCES auth_refresh_families(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT auth_refresh_tokens_token_digest_length_check CHECK (
    octet_length(token_digest) = 32
  ),
  CONSTRAINT auth_refresh_tokens_csrf_digest_length_check CHECK (
    octet_length(csrf_digest) = 32
  ),
  CONSTRAINT auth_refresh_tokens_parent_not_self_check CHECK (
    parent_token_id IS NULL OR parent_token_id <> id
  ),
  CONSTRAINT auth_refresh_tokens_idle_expiry_check CHECK (
    idle_expires_at > created_at
  ),
  CONSTRAINT auth_refresh_tokens_timestamps_ordered_check CHECK (
    (used_at IS NULL OR used_at >= created_at)
    AND updated_at >= created_at
  ),
  CONSTRAINT auth_refresh_tokens_tenant_family_id_key UNIQUE (tenant_id, family_id, id),
  CONSTRAINT auth_refresh_tokens_parent_same_family_fkey
    FOREIGN KEY (tenant_id, family_id, parent_token_id)
    REFERENCES auth_refresh_tokens(tenant_id, family_id, id) ON DELETE RESTRICT,
  CONSTRAINT auth_refresh_tokens_token_digest_key UNIQUE (token_digest)
);

CREATE UNIQUE INDEX auth_refresh_tokens_one_current_family_key
ON auth_refresh_tokens (family_id)
WHERE used_at IS NULL;

CREATE UNIQUE INDEX auth_refresh_tokens_one_root_family_key
ON auth_refresh_tokens (family_id)
WHERE parent_token_id IS NULL;

CREATE UNIQUE INDEX auth_refresh_tokens_one_child_per_parent_key
ON auth_refresh_tokens (parent_token_id)
WHERE parent_token_id IS NOT NULL;

CREATE INDEX auth_refresh_tokens_tenant_family_created_idx
ON auth_refresh_tokens (tenant_id, family_id, created_at, id);

CREATE INDEX auth_refresh_tokens_active_idle_expiry_idx
ON auth_refresh_tokens (idle_expires_at)
WHERE used_at IS NULL;

CREATE FUNCTION mark_auth_refresh_token_used()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.parent_token_id IS DISTINCT FROM OLD.parent_token_id
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.csrf_digest IS DISTINCT FROM OLD.csrf_digest
     OR NEW.idle_expires_at IS DISTINCT FROM OLD.idle_expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'token identity and lifetime are immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.used_at IS NOT NULL OR NEW.used_at IS NULL THEN
    RAISE EXCEPTION 'token use is immutable' USING ERRCODE = '23514';
  END IF;

  NEW.used_at = now();
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_refresh_tokens_mark_used
BEFORE UPDATE ON auth_refresh_tokens
FOR EACH ROW
EXECUTE FUNCTION mark_auth_refresh_token_used();
