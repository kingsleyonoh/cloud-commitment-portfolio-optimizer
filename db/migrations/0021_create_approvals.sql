CREATE UNIQUE INDEX recommendations_tenant_id_key
ON recommendations (tenant_id, id);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  recommendation_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_by_user_id UUID NULL,
  assigned_to_user_id UUID NULL,
  workflow_execution_id TEXT NULL,
  decision_reason TEXT NULL,
  approval_snapshot JSONB NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approvals_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT approvals_tenant_recommendation_fkey
    FOREIGN KEY (tenant_id, recommendation_id)
    REFERENCES recommendations(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT approvals_tenant_requested_user_fkey
    FOREIGN KEY (tenant_id, requested_by_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT approvals_tenant_assigned_user_fkey
    FOREIGN KEY (tenant_id, assigned_to_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT approvals_status_check CHECK (
    status IN ('queued', 'pending', 'approved', 'rejected', 'expired', 'failed')
  ),
  CONSTRAINT approvals_workflow_execution_id_check CHECK (
    workflow_execution_id IS NULL
    OR (
      workflow_execution_id = btrim(workflow_execution_id)
      AND workflow_execution_id <> ''
      AND length(workflow_execution_id) <= 512
      AND workflow_execution_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT approvals_decision_reason_check CHECK (
    decision_reason IS NULL
    OR (
      decision_reason = btrim(decision_reason)
      AND decision_reason <> ''
      AND length(decision_reason) <= 2000
      AND decision_reason !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT approvals_snapshot_object_check CHECK (
    jsonb_typeof(approval_snapshot) = 'object'
    AND octet_length(approval_snapshot::text) <= 1048576
    AND NOT approval_snapshot ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows', 'approval_token',
      'solver_variable', 'solver_variables', 'candidate_id'
    ]
  ),
  CONSTRAINT approvals_timestamps_ordered_check CHECK (
    expires_at > requested_at
    AND created_at >= requested_at
    AND updated_at >= created_at
    AND (
      decided_at IS NULL
      OR decided_at >= requested_at
    )
    AND (
      status IN ('queued', 'pending')
      OR decided_at IS NOT NULL
    )
    AND (
      status NOT IN ('queued', 'pending')
      OR decided_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX approvals_recommendation_state_key
ON approvals (tenant_id, recommendation_id)
WHERE status IN ('queued', 'pending');

CREATE INDEX approvals_tenant_status_expires_idx
ON approvals (tenant_id, status, expires_at);

CREATE INDEX approvals_tenant_recommendation_idx
ON approvals (tenant_id, recommendation_id);

CREATE FUNCTION enforce_approval_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recommendation_status TEXT;
  recommendation_requires_approval BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status, approval_required
    INTO recommendation_status, recommendation_requires_approval
    FROM recommendations
    WHERE tenant_id = NEW.tenant_id AND id = NEW.recommendation_id
    FOR SHARE;

    IF FOUND AND (
      recommendation_status <> 'pending_approval'
      OR recommendation_requires_approval IS DISTINCT FROM true
    ) THEN
      RAISE EXCEPTION 'approvals require a pending approval recommendation'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.status NOT IN ('queued', 'pending') THEN
      RAISE EXCEPTION 'approvals must start queued or pending'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approvals cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id, NEW.tenant_id, NEW.recommendation_id, NEW.requested_by_user_id,
    NEW.assigned_to_user_id, NEW.approval_snapshot, NEW.requested_at,
    NEW.expires_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.tenant_id, OLD.recommendation_id, OLD.requested_by_user_id,
    OLD.assigned_to_user_id, OLD.approval_snapshot, OLD.requested_at,
    OLD.expires_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'approval request identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('approved', 'rejected', 'expired', 'failed') THEN
    RAISE EXCEPTION 'approval is terminal'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('pending', 'expired', 'failed'))
    OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'expired', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid approval status transition'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IN ('approved', 'rejected') AND NEW.decision_reason IS NULL THEN
    RAISE EXCEPTION 'approval decisions require a reason'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER approvals_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON approvals
FOR EACH ROW
EXECUTE FUNCTION enforce_approval_lifecycle();
