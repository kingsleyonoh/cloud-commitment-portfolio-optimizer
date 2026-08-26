import type { Pool, PoolClient, QueryResultRow } from "pg";

import { AppError } from "../shared/errors.js";
import type { RecommendationRecord } from "../recommendations/recommendations-types.js";
import type {
  ApprovalDecisionInput,
  ApprovalInsertInput,
  ApprovalListInput,
  ApprovalRecord,
} from "./approvals-types.js";

export interface ApprovalsRepository {
  createPending(tenantId: string, input: ApprovalInsertInput): Promise<ApprovalRecord>;
  list(tenantId: string, input: ApprovalListInput): Promise<ApprovalRecord[]>;
  get(tenantId: string, id: string): Promise<ApprovalRecord | null>;
  approve(tenantId: string, input: ApprovalDecisionInput): Promise<ApprovalRecord | null>;
  reject(tenantId: string, input: ApprovalDecisionInput): Promise<ApprovalRecord | null>;
  getRecommendation(tenantId: string, id: string): Promise<RecommendationRecord | null>;
}

interface ApprovalRow extends QueryResultRow {
  id: string;
  recommendationId: string;
  status: ApprovalRecord["status"];
  requestedByUserId: string | null;
  assignedToUserId: string | null;
  workflowExecutionId: string | null;
  decisionReason: string | null;
  approvalSnapshot: Record<string, unknown>;
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface RecommendationRow extends QueryResultRow {
  id: string;
  optimizerRunId: string;
  recommendationType: RecommendationRecord["recommendationType"];
  provider: RecommendationRecord["provider"];
  instrument: RecommendationRecord["instrument"];
  serviceCode: string;
  region: string;
  termMonths: number;
  commitmentAmountCents: string;
  expectedSavingsCents: string;
  p95DownsideLossCents: string;
  utilizationP50Pct: string;
  utilizationP95Pct: string;
  confidenceScore: string;
  riskBand: RecommendationRecord["riskBand"];
  status: RecommendationRecord["status"];
  explanation: Record<string, unknown>;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SnapshotRow extends QueryResultRow {
  tenantName: string;
  tenantLegalName: string;
  tenantDisplayName: string;
  tenantContactEmail: string | null;
  tenantContactPhone: string | null;
  tenantSupportUrl: string | null;
  tenantFinanceOwnerEmail: string | null;
  assignedToEmail: string | null;
}

const APPROVAL_PROJECTION = `id, recommendation_id AS "recommendationId", status,
  requested_by_user_id AS "requestedByUserId", assigned_to_user_id AS "assignedToUserId",
  workflow_execution_id AS "workflowExecutionId", decision_reason AS "decisionReason",
  approval_snapshot AS "approvalSnapshot",
  to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "requestedAt",
  CASE WHEN decided_at IS NULL THEN NULL ELSE to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "decidedAt",
  to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "expiresAt",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

const RECOMMENDATION_PROJECTION = `id, optimizer_run_id AS "optimizerRunId",
  recommendation_type AS "recommendationType", provider, instrument,
  service_code AS "serviceCode", region, term_months AS "termMonths",
  commitment_amount_cents::text AS "commitmentAmountCents",
  expected_savings_cents::text AS "expectedSavingsCents",
  p95_downside_loss_cents::text AS "p95DownsideLossCents",
  to_char(utilization_p50_pct, 'FM990.00') AS "utilizationP50Pct",
  to_char(utilization_p95_pct, 'FM990.00') AS "utilizationP95Pct",
  to_char(confidence_score, 'FM0.0000') AS "confidenceScore",
  risk_band AS "riskBand", status, explanation, approval_required AS "approvalRequired",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createApprovalsRepository(pool: Pool): ApprovalsRepository {
  return {
    createPending: (tenantId, input) => createPending(pool, tenantId, input),
    list: (tenantId, input) => list(pool, tenantId, input),
    get: (tenantId, id) => get(pool, tenantId, id),
    approve: (tenantId, input) => decide(pool, tenantId, input, "approved"),
    reject: (tenantId, input) => decide(pool, tenantId, input, "rejected"),
    getRecommendation: (tenantId, id) => getRecommendation(pool, tenantId, id),
  };
}

async function createPending(
  pool: Pool,
  tenantId: string,
  input: ApprovalInsertInput,
): Promise<ApprovalRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recommendation = await getRecommendationForUpdate(
      client,
      tenantId,
      input.recommendationId,
    );
    if (!recommendation) {
      await client.query("ROLLBACK");
      return nullResource();
    }
    if (recommendation.status !== "pending_approval" || !recommendation.approvalRequired) {
      throw invalidState("Recommendation is not awaiting approval.");
    }
    const snapshotContext = await readSnapshotContext(client, tenantId, input.assignedToUserId);
    if (!snapshotContext) {
      await client.query("ROLLBACK");
      return nullResource();
    }
    const snapshot = buildApprovalSnapshot(recommendation, snapshotContext, input);
    const created = await client.query<ApprovalRow>(
      `INSERT INTO approvals
         (tenant_id, recommendation_id, status, requested_by_user_id, assigned_to_user_id,
          decision_reason, approval_snapshot, expires_at)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6::jsonb, $7)
       RETURNING ${APPROVAL_PROJECTION}`,
      [
        tenantId,
        input.recommendationId,
        input.requestedByUserId,
        input.assignedToUserId,
        null,
        JSON.stringify(snapshot),
        input.expiresAt.toISOString(),
      ],
    );
    await client.query("COMMIT");
    return freezeApproval(created.rows[0]!);
  } catch (error) {
    await rollback(client);
    throw mapWriteError(error);
  } finally {
    client.release();
  }
}

async function list(
  pool: Pool,
  tenantId: string,
  input: ApprovalListInput,
): Promise<ApprovalRecord[]> {
  const result = await pool.query<ApprovalRow>(
    `SELECT ${APPROVAL_PROJECTION}
       FROM approvals
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::uuid IS NULL OR assigned_to_user_id = $3)
        AND ($4::uuid IS NULL OR recommendation_id = $4)
        AND ($5::timestamptz IS NULL OR (requested_at, id) < ($5::timestamptz, $6::uuid))
      ORDER BY requested_at DESC, id DESC
      LIMIT $7`,
    [
      tenantId,
      input.status ?? null,
      input.assignedToUserId ?? null,
      input.recommendationId ?? null,
      input.cursor?.requestedAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeApproval);
}

async function get(pool: Pool, tenantId: string, id: string): Promise<ApprovalRecord | null> {
  const result = await pool.query<ApprovalRow>(
    `SELECT ${APPROVAL_PROJECTION}
       FROM approvals
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeApproval(result.rows[0]) : null;
}

async function decide(
  pool: Pool,
  tenantId: string,
  input: ApprovalDecisionInput,
  status: "approved" | "rejected",
): Promise<ApprovalRecord | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const approval = await client.query<ApprovalRow>(
      `SELECT ${APPROVAL_PROJECTION}
         FROM approvals
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, input.approvalId],
    );
    if (!approval.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    if (approval.rows[0].status !== "pending") throw invalidState("Approval is not pending.");
    await client.query(
      `UPDATE recommendations
          SET status = $3
        WHERE tenant_id = $1 AND id = $2 AND status = 'pending_approval'`,
      [tenantId, approval.rows[0].recommendationId, status],
    );
    const updated = await client.query<ApprovalRow>(
      `UPDATE approvals
          SET status = $3, decision_reason = $4, decided_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${APPROVAL_PROJECTION}`,
      [tenantId, input.approvalId, status, input.decisionReason],
    );
    await client.query("COMMIT");
    return freezeApproval(updated.rows[0]!);
  } catch (error) {
    await rollback(client);
    throw mapWriteError(error);
  } finally {
    client.release();
  }
}

async function getRecommendation(
  pool: Pool,
  tenantId: string,
  id: string,
): Promise<RecommendationRecord | null> {
  const result = await pool.query<RecommendationRow>(
    `SELECT ${RECOMMENDATION_PROJECTION}
       FROM recommendations
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRecommendation(result.rows[0]) : null;
}

async function getRecommendationForUpdate(
  client: PoolClient,
  tenantId: string,
  id: string,
): Promise<RecommendationRecord | null> {
  const result = await client.query<RecommendationRow>(
    `SELECT ${RECOMMENDATION_PROJECTION}
       FROM recommendations
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRecommendation(result.rows[0]) : null;
}

async function readSnapshotContext(
  client: PoolClient,
  tenantId: string,
  assignedToUserId?: string | null,
): Promise<SnapshotRow | null> {
  const result = await client.query<SnapshotRow>(
    `SELECT tenants.name AS "tenantName",
            tenants.legal_name AS "tenantLegalName",
            tenants.display_name AS "tenantDisplayName",
            tenants.contact_email AS "tenantContactEmail",
            tenants.contact_phone AS "tenantContactPhone",
            tenants.support_url AS "tenantSupportUrl",
            tenants.finance_owner_email AS "tenantFinanceOwnerEmail",
            users.email AS "assignedToEmail"
       FROM tenants
       LEFT JOIN users
         ON users.tenant_id = tenants.id
        AND users.id = $2::uuid
        AND users.is_active = true
        AND users.role IN ('finance_approver', 'tenant_admin')
      WHERE tenants.id = $1
        AND tenants.is_active = true
        AND ($2::uuid IS NULL OR users.id IS NOT NULL)`,
    [tenantId, assignedToUserId ?? null],
  );
  return result.rows[0] ?? null;
}

function buildApprovalSnapshot(
  recommendation: RecommendationRecord,
  context: SnapshotRow,
  input: ApprovalInsertInput,
): Record<string, unknown> {
  return {
    contract_version: "approval_packet:v1",
    tenant: {
      name: context.tenantName,
      legal_name: context.tenantLegalName,
      display_name: context.tenantDisplayName,
      contact: {
        email: context.tenantContactEmail,
        phone: context.tenantContactPhone,
        support_url: context.tenantSupportUrl,
        finance_owner_email: context.tenantFinanceOwnerEmail,
      },
    },
    recommendation: {
      id: recommendation.id,
      type: recommendation.recommendationType,
      provider: recommendation.provider,
      instrument: recommendation.instrument,
      service_code: recommendation.serviceCode,
      region: recommendation.region,
      term_months: recommendation.termMonths,
      commitment_amount_cents: recommendation.commitmentAmountCents,
      expected_savings_cents: recommendation.expectedSavingsCents,
      p95_downside_loss_cents: recommendation.p95DownsideLossCents,
      utilization_p50_pct: recommendation.utilizationP50Pct,
      utilization_p95_pct: recommendation.utilizationP95Pct,
      confidence_score: recommendation.confidenceScore,
      risk_band: recommendation.riskBand,
      explanation: recommendation.explanation,
    },
    approval: {
      status: "pending",
      assigned_to: context.assignedToEmail,
      expires_at: input.expiresAt.toISOString(),
      decision_reason: null,
      request_reason: input.reason,
    },
  };
}

function freezeApproval(row: ApprovalRow): ApprovalRecord {
  return Object.freeze({
    id: row.id,
    recommendationId: row.recommendationId,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    assignedToUserId: row.assignedToUserId,
    workflowExecutionId: row.workflowExecutionId,
    decisionReason: row.decisionReason,
    approvalSnapshot: Object.freeze({ ...row.approvalSnapshot }),
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function freezeRecommendation(row: RecommendationRow): RecommendationRecord {
  return Object.freeze({
    id: row.id,
    optimizerRunId: row.optimizerRunId,
    recommendationType: row.recommendationType,
    provider: row.provider,
    instrument: row.instrument,
    serviceCode: row.serviceCode,
    region: row.region,
    termMonths: row.termMonths,
    commitmentAmountCents: row.commitmentAmountCents,
    expectedSavingsCents: row.expectedSavingsCents,
    p95DownsideLossCents: row.p95DownsideLossCents,
    utilizationP50Pct: row.utilizationP50Pct,
    utilizationP95Pct: row.utilizationP95Pct,
    confidenceScore: row.confidenceScore,
    riskBand: row.riskBand,
    status: row.status,
    explanation: Object.freeze({ ...row.explanation }),
    approvalRequired: row.approvalRequired,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

function mapWriteError(error: unknown): Error {
  if (error instanceof AppError) return error;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (code === "23505" || code === "55000") {
      return invalidState("Approval state is no longer current.");
    }
  }
  return error instanceof Error ? error : new Error("Approval write failed.");
}

function invalidState(message: string): AppError {
  return new AppError({
    code: "APPROVAL_STATE_INVALID",
    message,
    statusCode: 409,
    details: [],
  });
}

function nullResource(): never {
  throw new AppError({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    statusCode: 404,
    details: [],
  });
}
