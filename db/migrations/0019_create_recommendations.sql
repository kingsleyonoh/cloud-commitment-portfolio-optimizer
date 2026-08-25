CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  optimizer_run_id UUID NOT NULL,
  recommendation_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  instrument TEXT NOT NULL,
  service_code TEXT NOT NULL,
  region TEXT NOT NULL,
  term_months INT NOT NULL,
  commitment_amount_cents BIGINT NOT NULL,
  expected_savings_cents BIGINT NOT NULL,
  p95_downside_loss_cents BIGINT NOT NULL,
  utilization_p50_pct NUMERIC(5,2) NOT NULL,
  utilization_p95_pct NUMERIC(5,2) NOT NULL,
  confidence_score NUMERIC(5,4) NOT NULL,
  risk_band TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recommendations_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT recommendations_tenant_run_fkey
    FOREIGN KEY (tenant_id, optimizer_run_id)
    REFERENCES optimizer_runs(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT recommendations_type_check CHECK (
    recommendation_type IN (
      'buy', 'renew', 'resize', 'sell_or_exchange', 'no_action', 'manual_review'
    )
  ),
  CONSTRAINT recommendations_provider_check CHECK (
    provider IN ('aws', 'azure', 'gcp')
  ),
  CONSTRAINT recommendations_instrument_check CHECK (
    instrument IN (
      'aws_compute_savings_plan',
      'aws_reserved_instance',
      'azure_savings_plan',
      'azure_reservation',
      'gcp_committed_use_discount'
    )
  ),
  CONSTRAINT recommendations_provider_instrument_check CHECK (
    (provider = 'aws' AND instrument IN (
      'aws_compute_savings_plan', 'aws_reserved_instance'
    ))
    OR (provider = 'azure' AND instrument IN (
      'azure_savings_plan', 'azure_reservation'
    ))
    OR (provider = 'gcp' AND instrument = 'gcp_committed_use_discount')
  ),
  CONSTRAINT recommendations_text_fields_check CHECK (
    service_code = btrim(service_code)
    AND service_code <> ''
    AND length(service_code) <= 128
    AND service_code !~ '[[:cntrl:]]'
    AND region = btrim(region)
    AND region <> ''
    AND length(region) <= 128
    AND region !~ '[[:cntrl:]]'
  ),
  CONSTRAINT recommendations_economics_check CHECK (
    term_months > 0
    AND commitment_amount_cents >= 0
    AND expected_savings_cents >= 0
    AND p95_downside_loss_cents >= 0
    AND utilization_p50_pct >= 0.00
    AND utilization_p50_pct <= 100.00
    AND utilization_p95_pct >= 0.00
    AND utilization_p95_pct <= 100.00
    AND confidence_score >= 0.0000
    AND confidence_score <= 1.0000
  ),
  CONSTRAINT recommendations_risk_band_check CHECK (
    risk_band IN ('low', 'medium', 'high', 'blocked')
  ),
  CONSTRAINT recommendations_status_check CHECK (
    status IN (
      'draft', 'ready', 'pending_approval', 'approved', 'rejected',
      'superseded', 'executed', 'expired'
    )
  ),
  CONSTRAINT recommendations_approval_state_check CHECK (
    (
      approval_required = false
      AND status IN ('draft', 'ready', 'superseded')
    )
    OR approval_required = true
  ),
  CONSTRAINT recommendations_explanation_object_check CHECK (
    jsonb_typeof(explanation) = 'object'
    AND octet_length(explanation::text) <= 65536
    AND NOT explanation ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows',
      'solver_variable', 'solver_variables', 'candidate_id'
    ]
  ),
  CONSTRAINT recommendations_timestamps_ordered_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX recommendations_tenant_status_risk_created_idx
ON recommendations (tenant_id, status, risk_band, created_at);

CREATE INDEX recommendations_tenant_provider_instrument_region_idx
ON recommendations (tenant_id, provider, instrument, region);

CREATE INDEX recommendations_tenant_run_idx
ON recommendations (tenant_id, optimizer_run_id);

CREATE FUNCTION enforce_recommendation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_provider TEXT;
  parent_instrument TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT provider, instrument
    INTO parent_provider, parent_instrument
    FROM optimizer_runs
    WHERE tenant_id = NEW.tenant_id AND id = NEW.optimizer_run_id
    FOR SHARE;

    IF FOUND AND (parent_provider <> NEW.provider OR parent_instrument <> NEW.instrument) THEN
      RAISE EXCEPTION 'recommendation instrument must match optimizer run'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recommendations cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id, NEW.tenant_id, NEW.optimizer_run_id, NEW.recommendation_type,
    NEW.provider, NEW.instrument, NEW.service_code, NEW.region, NEW.term_months,
    NEW.commitment_amount_cents, NEW.expected_savings_cents,
    NEW.p95_downside_loss_cents, NEW.utilization_p50_pct, NEW.utilization_p95_pct,
    NEW.confidence_score, NEW.risk_band, NEW.explanation, NEW.approval_required,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.tenant_id, OLD.optimizer_run_id, OLD.recommendation_type,
    OLD.provider, OLD.instrument, OLD.service_code, OLD.region, OLD.term_months,
    OLD.commitment_amount_cents, OLD.expected_savings_cents,
    OLD.p95_downside_loss_cents, OLD.utilization_p50_pct, OLD.utilization_p95_pct,
    OLD.confidence_score, OLD.risk_band, OLD.explanation, OLD.approval_required,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'recommendation economic identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('rejected', 'superseded', 'executed', 'expired') THEN
    RAISE EXCEPTION 'recommendation is terminal'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('ready', 'pending_approval', 'superseded'))
    OR (OLD.status = 'ready' AND NEW.status IN ('pending_approval', 'superseded'))
    OR (OLD.status = 'pending_approval' AND NEW.status IN (
      'approved', 'rejected', 'expired', 'superseded'
    ))
    OR (OLD.status = 'approved' AND NEW.status IN ('executed', 'superseded'))
  ) THEN
    RAISE EXCEPTION 'invalid recommendation status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommendations_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON recommendations
FOR EACH ROW
EXECUTE FUNCTION enforce_recommendation_lifecycle();
