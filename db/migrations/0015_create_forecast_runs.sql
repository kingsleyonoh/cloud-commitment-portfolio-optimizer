CREATE TABLE forecast_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  forecast_model_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input_window_start DATE NOT NULL,
  input_window_end DATE NOT NULL,
  horizon_months INT NOT NULL,
  random_seed BIGINT NOT NULL,
  output_uri TEXT DEFAULT NULL,
  quality_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT forecast_runs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT forecast_runs_tenant_model_fkey
    FOREIGN KEY (tenant_id, forecast_model_id)
    REFERENCES forecast_models(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT forecast_runs_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT forecast_runs_input_window_check CHECK (
    input_window_end >= input_window_start
  ),
  CONSTRAINT forecast_runs_horizon_months_check CHECK (
    horizon_months IN (1, 3, 6, 12, 24, 36)
  ),
  CONSTRAINT forecast_runs_output_uri_canonical_check CHECK (
    output_uri IS NULL
    OR (
      output_uri = btrim(output_uri)
      AND output_uri <> ''
      AND length(output_uri) <= 2048
      AND output_uri !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT forecast_runs_quality_metrics_object_check CHECK (
    jsonb_typeof(quality_metrics) = 'object'
    AND octet_length(quality_metrics::text) <= 65536
    AND NOT quality_metrics ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT forecast_runs_error_details_object_check CHECK (
    jsonb_typeof(error_details) = 'object'
    AND octet_length(error_details::text) <= 16384
    AND NOT error_details ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'stack', 'stack_trace', 'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT forecast_runs_state_fields_check CHECK (
    (
      status IN ('queued', 'running')
      AND output_uri IS NULL
      AND quality_metrics = '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
    OR (
      status = 'completed'
      AND output_uri IS NOT NULL
      AND quality_metrics <> '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
    OR (
      status = 'failed'
      AND output_uri IS NULL
      AND quality_metrics = '{}'::jsonb
      AND error_details <> '{}'::jsonb
    )
    OR (
      status = 'cancelled'
      AND output_uri IS NULL
      AND quality_metrics = '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
  ),
  CONSTRAINT forecast_runs_timestamps_ordered_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX forecast_runs_tenant_model_status_created_idx
ON forecast_runs (tenant_id, forecast_model_id, status, created_at);

CREATE INDEX forecast_runs_tenant_window_created_idx
ON forecast_runs (tenant_id, input_window_end, created_at);

CREATE FUNCTION enforce_forecast_run_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'forecast runs must be created as queued'
        USING ERRCODE = '23514';
    END IF;

    SELECT status INTO parent_status
    FROM forecast_models
    WHERE tenant_id = NEW.tenant_id AND id = NEW.forecast_model_id
    FOR SHARE;

    IF FOUND AND parent_status <> 'active' THEN
      RAISE EXCEPTION 'forecast runs require an active model'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'forecast runs cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id, NEW.tenant_id, NEW.forecast_model_id, NEW.input_window_start,
    NEW.input_window_end, NEW.horizon_months, NEW.random_seed, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.tenant_id, OLD.forecast_model_id, OLD.input_window_start,
    OLD.input_window_end, OLD.horizon_months, OLD.random_seed, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'forecast run inputs are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'forecast run is terminal'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid forecast run status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER forecast_runs_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON forecast_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_forecast_run_lifecycle();
