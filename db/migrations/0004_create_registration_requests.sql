-- Supports the same-tenant result FK without changing accepted api_keys columns.
CREATE UNIQUE INDEX api_keys_tenant_id_id_key
ON api_keys (tenant_id, id);

CREATE TABLE registration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key_hash BYTEA NOT NULL,
  request_sha256 BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tenant_id UUID DEFAULT NULL,
  api_key_id UUID DEFAULT NULL,
  error_code TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registration_requests_idempotency_key_hash_32_bytes_check CHECK (
    octet_length(idempotency_key_hash) = 32
  ),
  CONSTRAINT registration_requests_request_sha256_32_bytes_check CHECK (
    octet_length(request_sha256) = 32
  ),
  CONSTRAINT registration_requests_status_check CHECK (
    status IN ('pending', 'succeeded', 'failed')
  ),
  CONSTRAINT registration_requests_pending_state_check CHECK (
    status <> 'pending'
    OR (tenant_id IS NULL AND api_key_id IS NULL AND error_code IS NULL)
  ),
  CONSTRAINT registration_requests_succeeded_state_check CHECK (
    status <> 'succeeded'
    OR (tenant_id IS NOT NULL AND api_key_id IS NOT NULL AND error_code IS NULL)
  ),
  CONSTRAINT registration_requests_failed_state_check CHECK (
    status <> 'failed'
    OR (tenant_id IS NULL AND api_key_id IS NULL AND error_code IS NOT NULL)
  ),
  CONSTRAINT registration_requests_error_code_trimmed_check CHECK (
    error_code IS NULL OR (error_code = btrim(error_code) AND error_code <> '')
  ),
  CONSTRAINT registration_requests_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT registration_requests_api_key_id_fkey
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE RESTRICT,
  CONSTRAINT registration_requests_result_api_key_tenant_fkey
    FOREIGN KEY (tenant_id, api_key_id)
    REFERENCES api_keys(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT registration_requests_idempotency_key_hash_key UNIQUE (idempotency_key_hash)
);

CREATE INDEX registration_requests_status_created_at_idx
ON registration_requests (status, created_at);

CREATE FUNCTION set_registration_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER registration_requests_set_updated_at
BEFORE UPDATE ON registration_requests
FOR EACH ROW
EXECUTE FUNCTION set_registration_requests_updated_at();
