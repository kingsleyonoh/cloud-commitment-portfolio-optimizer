CREATE TABLE ecosystem_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  target_system TEXT NOT NULL,
  next_attempt_at TIMESTAMPTZ NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ecosystem_events_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT ecosystem_events_status_check CHECK (
    status IN ('queued', 'sent', 'failed', 'disabled', 'retrying')
  ),
  CONSTRAINT ecosystem_events_target_system_check CHECK (
    target_system IN ('notification_hub', 'workflow_engine', 'invoice_reconciliation_engine')
  ),
  CONSTRAINT ecosystem_events_event_type_check CHECK (
    event_type = btrim(event_type)
    AND event_type <> ''
    AND length(event_type) <= 200
    AND event_type !~ '[[:cntrl:]]'
  ),
  CONSTRAINT ecosystem_events_event_id_check CHECK (
    event_id = btrim(event_id)
    AND event_id <> ''
    AND length(event_id) <= 200
    AND event_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT ecosystem_events_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 1048576
    AND NOT payload ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'api_key', 'apiKey', 'authorization', 'cookie', 'set-cookie',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows',
      'solver_variable', 'solver_variables', 'candidate_id'
    ]
  ),
  CONSTRAINT ecosystem_events_attempt_count_check CHECK (attempt_count BETWEEN 0 AND 1000),
  CONSTRAINT ecosystem_events_last_error_check CHECK (
    last_error IS NULL
    OR (
      last_error = btrim(last_error)
      AND last_error <> ''
      AND length(last_error) <= 2000
      AND last_error !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT ecosystem_events_status_fields_check CHECK (
    (status IN ('queued', 'retrying') AND next_attempt_at IS NOT NULL)
    OR (status IN ('sent', 'disabled') AND next_attempt_at IS NULL)
    OR status = 'failed'
  ),
  CONSTRAINT ecosystem_events_timestamps_ordered_check CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX ecosystem_events_tenant_target_event_key
ON ecosystem_events (tenant_id, target_system, event_id);

CREATE INDEX ecosystem_events_tenant_status_attempt_idx
ON ecosystem_events (tenant_id, status, next_attempt_at);

CREATE INDEX ecosystem_events_tenant_type_created_idx
ON ecosystem_events (tenant_id, event_type, created_at);

CREATE FUNCTION enforce_ecosystem_event_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ecosystem events cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('queued', 'disabled') THEN
      RAISE EXCEPTION 'ecosystem events must start queued or disabled' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.tenant_id, NEW.event_type, NEW.event_id, NEW.payload, NEW.target_system,
         NEW.created_at) IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.event_type, OLD.event_id, OLD.payload, OLD.target_system,
         OLD.created_at) THEN
    RAISE EXCEPTION 'ecosystem event identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('sent', 'disabled', 'failed') THEN
    RAISE EXCEPTION 'ecosystem event is terminal' USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('retrying', 'sent', 'failed', 'disabled'))
    OR (OLD.status = 'retrying' AND NEW.status IN ('retrying', 'sent', 'failed', 'disabled'))
  ) THEN
    RAISE EXCEPTION 'invalid ecosystem event status transition' USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ecosystem_events_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON ecosystem_events
FOR EACH ROW
EXECUTE FUNCTION enforce_ecosystem_event_lifecycle();
