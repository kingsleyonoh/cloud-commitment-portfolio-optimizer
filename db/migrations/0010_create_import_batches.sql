CREATE UNIQUE INDEX cloud_accounts_tenant_id_id_key
ON cloud_accounts (tenant_id, id);

CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cloud_account_id UUID DEFAULT NULL,
  source TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  object_uri TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  line_count BIGINT NOT NULL DEFAULT 0,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  parser_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id UUID DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT import_batches_tenant_cloud_account_fkey
    FOREIGN KEY (tenant_id, cloud_account_id)
    REFERENCES cloud_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_batches_tenant_created_by_user_fkey
    FOREIGN KEY (tenant_id, created_by_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_batches_source_check CHECK (
    source IN ('aws_cur', 'azure_export', 'gcp_export', 'synthetic')
  ),
  CONSTRAINT import_batches_format_check CHECK (
    format IN ('csv', 'parquet', 'json_api_snapshot', 'native_cur', 'manual_override')
  ),
  CONSTRAINT import_batches_status_check CHECK (
    status IN ('queued', 'processing', 'completed', 'failed', 'quarantined', 'cancelled')
  ),
  CONSTRAINT import_batches_object_uri_trimmed_check CHECK (
    object_uri = btrim(object_uri)
    AND object_uri <> ''
    AND length(object_uri) <= 2048
    AND object_uri !~ '[[:cntrl:]]'
  ),
  CONSTRAINT import_batches_schema_version_trimmed_check CHECK (
    schema_version = btrim(schema_version)
    AND schema_version <> ''
    AND length(schema_version) <= 128
    AND schema_version !~ '[[:cntrl:]]'
  ),
  CONSTRAINT import_batches_line_count_nonnegative_check CHECK (
    line_count >= 0
    AND (status <> 'queued' OR line_count = 0)
  ),
  CONSTRAINT import_batches_error_details_object_check CHECK (
    jsonb_typeof(error_details) = 'object'
    AND octet_length(error_details::text) <= 8192
    AND NOT error_details ?| ARRAY[
      'stack', 'stack_trace', 'raw_file', 'raw_bytes', 'raw_row', 'raw_rows',
      'row_payload', 'credentials'
    ]
    AND (
      status NOT IN ('queued', 'processing', 'completed', 'failed', 'quarantined', 'cancelled')
      OR (status IN ('queued', 'processing', 'completed') AND error_details = '{}'::jsonb)
      OR (status IN ('failed', 'quarantined', 'cancelled') AND error_details <> '{}'::jsonb)
    )
  ),
  CONSTRAINT import_batches_parser_warnings_array_check CHECK (
    jsonb_typeof(parser_warnings) = 'array'
    AND octet_length(parser_warnings::text) <= 65536
    AND (status <> 'queued' OR parser_warnings = '[]'::jsonb)
  ),
  CONSTRAINT import_batches_timestamps_ordered_check CHECK (updated_at >= created_at)
);

CREATE INDEX import_batches_tenant_status_created_idx
ON import_batches (tenant_id, status, created_at);

CREATE INDEX import_batches_tenant_cloud_account_created_idx
ON import_batches (tenant_id, cloud_account_id, created_at);

CREATE FUNCTION set_import_batches_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_batches_set_updated_at
BEFORE UPDATE ON import_batches
FOR EACH ROW
EXECUTE FUNCTION set_import_batches_updated_at();
