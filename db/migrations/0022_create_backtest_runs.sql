CREATE UNIQUE INDEX optimizer_policies_tenant_id_key
ON optimizer_policies (tenant_id, id);

CREATE TABLE backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  policy_id UUID NOT NULL,
  baseline TEXT NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input_snapshot_uri TEXT NOT NULL,
  output_uri TEXT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT backtest_runs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT backtest_runs_tenant_policy_fkey
    FOREIGN KEY (tenant_id, policy_id)
    REFERENCES optimizer_policies(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT backtest_runs_tenant_user_fkey
    FOREIGN KEY (tenant_id, created_by_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT backtest_runs_name_check CHECK (
    name = btrim(name)
    AND name <> ''
    AND length(name) <= 200
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT backtest_runs_baseline_check CHECK (
    baseline IN ('no_commitment', 'last_month_steady_state', 'seventy_percent_utilization', 'custom')
  ),
  CONSTRAINT backtest_runs_window_check CHECK (
    window_end >= window_start
  ),
  CONSTRAINT backtest_runs_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT backtest_runs_uri_text_check CHECK (
    input_snapshot_uri = btrim(input_snapshot_uri)
    AND input_snapshot_uri <> ''
    AND length(input_snapshot_uri) <= 2048
    AND input_snapshot_uri !~ '[[:cntrl:]]'
    AND (
      output_uri IS NULL
      OR (
        output_uri = btrim(output_uri)
        AND output_uri <> ''
        AND length(output_uri) <= 2048
        AND output_uri !~ '[[:cntrl:]]'
      )
    )
  ),
  CONSTRAINT backtest_runs_metrics_object_check CHECK (
    jsonb_typeof(metrics) = 'object'
    AND octet_length(metrics::text) <= 1048576
    AND NOT metrics ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows',
      'solver_variable', 'solver_variables', 'temp_table', 'worker_shard_id'
    ]
  ),
  CONSTRAINT backtest_runs_error_details_object_check CHECK (
    jsonb_typeof(error_details) = 'object'
    AND octet_length(error_details::text) <= 65536
    AND NOT error_details ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows', 'stack'
    ]
  ),
  CONSTRAINT backtest_runs_completion_check CHECK (
    (
      status = 'completed'
      AND output_uri IS NOT NULL
      AND metrics <> '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
    OR (
      status = 'failed'
      AND output_uri IS NULL
      AND error_details <> '{}'::jsonb
    )
    OR (
      status IN ('queued', 'running', 'cancelled')
      AND output_uri IS NULL
    )
  ),
  CONSTRAINT backtest_runs_timestamps_ordered_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX backtest_runs_tenant_status_created_idx
ON backtest_runs (tenant_id, status, created_at);

CREATE INDEX backtest_runs_tenant_policy_window_idx
ON backtest_runs (tenant_id, policy_id, window_end);

CREATE FUNCTION enforce_backtest_run_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'backtest runs cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'backtest runs must start queued'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.id, NEW.tenant_id, NEW.name, NEW.policy_id, NEW.baseline,
    NEW.window_start, NEW.window_end, NEW.input_snapshot_uri,
    NEW.created_by_user_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.tenant_id, OLD.name, OLD.policy_id, OLD.baseline,
    OLD.window_start, OLD.window_end, OLD.input_snapshot_uri,
    OLD.created_by_user_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'backtest run replay identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'backtest run is terminal'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid backtest run status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER backtest_runs_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON backtest_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_backtest_run_lifecycle();
