CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT users_email_canonical_check CHECK (
    email = btrim(email)
    AND email = lower(email)
    AND email <> ''
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  CONSTRAINT users_name_trimmed_check CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT users_role_check CHECK (
    role IN ('tenant_admin', 'finops_analyst', 'finance_approver', 'read_only_auditor')
  ),
  CONSTRAINT users_timestamps_ordered_check CHECK (updated_at >= created_at),
  CONSTRAINT users_tenant_email_key UNIQUE (tenant_id, email)
);

CREATE INDEX users_tenant_role_active_idx ON users (tenant_id, role, is_active);

CREATE FUNCTION set_users_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_users_updated_at();
