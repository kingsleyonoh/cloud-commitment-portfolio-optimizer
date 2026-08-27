CREATE TABLE user_auth_credentials (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  password_hash TEXT NOT NULL,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_auth_credentials_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT user_auth_credentials_tenant_user_fkey
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT user_auth_credentials_password_hash_check CHECK (
    password_hash = btrim(password_hash)
    AND password_hash <> ''
    AND octet_length(password_hash) <= 512
    AND password_hash LIKE '$argon2id$v=19$%'
  ),
  CONSTRAINT user_auth_credentials_timestamps_ordered_check CHECK (
    password_changed_at >= created_at
    AND updated_at >= created_at
  ),
  CONSTRAINT user_auth_credentials_tenant_user_key UNIQUE (tenant_id, user_id)
);

CREATE FUNCTION set_user_auth_credentials_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'credential identity is immutable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at = OLD.created_at;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_auth_credentials_set_updated_at
BEFORE UPDATE ON user_auth_credentials
FOR EACH ROW
EXECUTE FUNCTION set_user_auth_credentials_updated_at();
