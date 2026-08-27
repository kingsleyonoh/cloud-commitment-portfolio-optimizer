import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertActivePriceVersion,
  insertCompletedForecastRun,
  insertOptimizerPolicy,
  insertOptimizerRun,
  insertOptimizerTenant,
} from "./helpers/optimizer-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;
let tenantA: string;
let tenantB: string;
let requesterA: string;
let approverA: string;
let requesterB: string;
const activePriceVersionsByTenant = new Map<string, string>();

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_approvals_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertOptimizerTenant(client, "approval tenant a");
  tenantB = await insertOptimizerTenant(client, "approval tenant b");
  requesterA = await insertUser(tenantA, "analyst@example.invalid", "finops_analyst");
  approverA = await insertUser(tenantA, "approver@example.invalid", "finance_approver");
  requesterB = await insertUser(tenantB, "other@example.invalid", "finops_analyst");
  activePriceVersionsByTenant.set(
    tenantA,
    await insertActivePriceVersion(client, tenantA, "approval-price-a"),
  );
  activePriceVersionsByTenant.set(
    tenantB,
    await insertActivePriceVersion(client, tenantB, "approval-price-b"),
  );
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function insertUser(tenantId: string, email: string, role: string): Promise<string> {
  return (
    await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, $2, 'Approval User', $3)
       RETURNING id`,
      [tenantId, email, role],
    )
  ).rows[0]!.id;
}

async function createPendingApprovalRecommendation(tenantId: string): Promise<string> {
  const label = `approval-${randomUUID()}`;
  const forecast = await insertCompletedForecastRun(client, tenantId, label);
  const priceVersion = activePriceVersionsByTenant.get(tenantId);
  if (!priceVersion) {
    throw new Error(`missing active price version for tenant ${tenantId}`);
  }
  const policy = (await insertOptimizerPolicy(client, tenantId, `approval policy ${label}`))
    .rows[0]!.id;
  await client.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [policy]);
  const run = (await insertOptimizerRun(client, tenantId, forecast, policy, [priceVersion]))
    .rows[0]!.id;
  return (
    await client.query<{ id: string }>(
      `INSERT INTO recommendations
         (tenant_id, optimizer_run_id, recommendation_type, provider, instrument, service_code,
          region, term_months, commitment_amount_cents, expected_savings_cents,
          p95_downside_loss_cents, utilization_p50_pct, utilization_p95_pct, confidence_score,
          risk_band, status, explanation, approval_required)
       VALUES ($1, $2, 'buy', 'aws', 'aws_compute_savings_plan', 'AmazonEC2',
               'us-east-1', 12, 1000000, 180000, 40000, 86.25, 94.75, 0.9400,
               'low', 'pending_approval', '{"binding_constraints":["risk_budget"]}'::jsonb, true)
       RETURNING id`,
      [tenantId, run],
    )
  ).rows[0]!.id;
}

async function insertApproval(overrides: Record<string, unknown> = {}) {
  const recommendationId =
    typeof overrides.recommendationId === "string"
      ? overrides.recommendationId
      : await createPendingApprovalRecommendation(String(overrides.tenantId ?? tenantA));
  return client.query<{ id: string; status: string }>(
    `INSERT INTO approvals
       (tenant_id, recommendation_id, status, requested_by_user_id, assigned_to_user_id,
        workflow_execution_id, approval_snapshot, requested_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     RETURNING id, status`,
    [
      overrides.tenantId ?? tenantA,
      recommendationId,
      overrides.status ?? "pending",
      overrides.requestedByUserId ?? requesterA,
      overrides.assignedToUserId ?? approverA,
      overrides.workflowExecutionId ?? null,
      JSON.stringify(
        overrides.approvalSnapshot ?? {
          tenant: { contact: { finance_owner_email: "finance@example.invalid" } },
          recommendation: { id: recommendationId, expected_savings_cents: "180000" },
          approval: {
            status: "pending",
            assigned_to: "approver@example.invalid",
            expires_at: "2026-08-27T00:00:00.000Z",
            decision_reason: null,
          },
        },
      ),
      overrides.requestedAt ?? "2026-08-26T00:00:00.000Z",
      overrides.expiresAt ?? "2026-08-27T00:00:00.000Z",
    ],
  );
}

describe("approval snapshot ownership and lifecycle rules", () => {
  it("persists an immutable approval packet tied to same-tenant recommendation and users", async () => {
    const approval = await insertApproval({ workflowExecutionId: "workflow-123" });
    const stored = await client.query<{
      approval_snapshot: unknown;
      workflow_execution_id: string;
    }>("SELECT approval_snapshot, workflow_execution_id FROM approvals WHERE id = $1", [
      approval.rows[0]!.id,
    ]);

    expect(stored.rows[0]).toMatchObject({
      workflow_execution_id: "workflow-123",
      approval_snapshot: {
        approval: {
          status: "pending",
          assigned_to: "approver@example.invalid",
          decision_reason: null,
        },
      },
    });
  });

  it("rejects cross-tenant recommendation/users and unsafe snapshots", async () => {
    await expect(insertApproval({ requestedByUserId: requesterB })).rejects.toMatchObject({
      constraint: "approvals_tenant_requested_user_fkey",
    });
    const crossTenantRecommendation = await createPendingApprovalRecommendation(tenantA);
    await expect(
      insertApproval({
        tenantId: tenantB,
        recommendationId: crossTenantRecommendation,
        requestedByUserId: requesterB,
        assignedToUserId: null,
      }),
    ).rejects.toMatchObject({
      constraint: "approvals_tenant_recommendation_fkey",
    });
    await expect(
      insertApproval({ approvalSnapshot: { approval: {}, token: "approval-secret" } }),
    ).rejects.toMatchObject({ constraint: "approvals_snapshot_object_check" });
  });

  it("freezes request identity and snapshot while allowing one terminal decision", async () => {
    const approval = await insertApproval();
    await expect(
      client.query("UPDATE approvals SET approval_snapshot = '{}'::jsonb WHERE id = $1", [
        approval.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "approval request identity is immutable" });

    await client.query(
      `UPDATE approvals
       SET status = 'approved', decision_reason = 'Budget owner approved', decided_at = now()
       WHERE id = $1`,
      [approval.rows[0]!.id],
    );
    await expect(
      client.query("UPDATE approvals SET status = 'rejected' WHERE id = $1", [
        approval.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "approval is terminal" });
  });

  it("enforces pending-only open approvals, expiry, nonempty decisions, and delete prevention", async () => {
    const recommendation = await createPendingApprovalRecommendation(tenantA);
    const approval = await insertApproval({ recommendationId: recommendation });
    await expect(insertApproval({ recommendationId: recommendation })).rejects.toMatchObject({
      constraint: "approvals_recommendation_state_key",
    });
    await expect(
      client.query(
        "UPDATE approvals SET status = 'rejected', decision_reason = '', decided_at = now() WHERE id = $1",
        [approval.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ constraint: "approvals_decision_reason_check" });
    await client.query(
      "UPDATE approvals SET status = 'expired', decided_at = now() WHERE id = $1",
      [approval.rows[0]!.id],
    );
    await expect(
      client.query("DELETE FROM approvals WHERE id = $1", [approval.rows[0]!.id]),
    ).rejects.toMatchObject({ code: "55000", message: "approvals cannot be deleted" });
  });
});
