CREATE TABLE report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  snapshot_json JSONB NOT NULL,
  rendered_html_uri TEXT NULL,
  rendered_pdf_uri TEXT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_by_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_snapshots_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT report_snapshots_tenant_user_fkey
    FOREIGN KEY (tenant_id, created_by_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT report_snapshots_source_type_check CHECK (
    source_type IN ('recommendation', 'optimizer_run', 'backtest_run', 'approval')
  ),
  CONSTRAINT report_snapshots_snapshot_json_object_check CHECK (
    jsonb_typeof(snapshot_json) = 'object'
    AND octet_length(snapshot_json::text) <= 1048576
    AND NOT snapshot_json ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows', 'approval_token'
    ]
  ),
  CONSTRAINT report_snapshots_uri_text_check CHECK (
    (
      rendered_html_uri IS NULL
      OR (
        rendered_html_uri = btrim(rendered_html_uri)
        AND rendered_html_uri <> ''
        AND length(rendered_html_uri) <= 2048
        AND rendered_html_uri !~ '[[:cntrl:]]'
      )
    )
    AND (
      rendered_pdf_uri IS NULL
      OR (
        rendered_pdf_uri = btrim(rendered_pdf_uri)
        AND rendered_pdf_uri <> ''
        AND length(rendered_pdf_uri) <= 2048
        AND rendered_pdf_uri !~ '[[:cntrl:]]'
      )
    )
  ),
  CONSTRAINT report_snapshots_status_check CHECK (
    status IN ('queued', 'rendered', 'failed', 'archived')
  ),
  CONSTRAINT report_snapshots_rendered_uri_check CHECK (
    status <> 'rendered'
    OR rendered_html_uri IS NOT NULL
    OR rendered_pdf_uri IS NOT NULL
  ),
  CONSTRAINT report_snapshots_timestamps_ordered_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX report_snapshots_tenant_source_idx
ON report_snapshots (tenant_id, source_type, source_id);

CREATE INDEX report_snapshots_tenant_status_created_idx
ON report_snapshots (tenant_id, status, created_at);

CREATE FUNCTION enforce_report_snapshot_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'report snapshots must start queued'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'report snapshots cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id, NEW.tenant_id, NEW.source_type, NEW.source_id,
    NEW.snapshot_json, NEW.created_by_user_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.tenant_id, OLD.source_type, OLD.source_id,
    OLD.snapshot_json, OLD.created_by_user_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'report snapshot identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'report snapshot is archived'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('rendered', 'failed', 'archived'))
    OR (OLD.status IN ('rendered', 'failed') AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'invalid report snapshot status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER report_snapshots_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON report_snapshots
FOR EACH ROW
EXECUTE FUNCTION enforce_report_snapshot_lifecycle();
