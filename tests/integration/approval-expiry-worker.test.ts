import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { Pool, type Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApprovalExpiryWorker } from "../../core/approvals/approval-expiry-worker.js";
import { createApprovalsRepository } from "../../core/approvals/approvals-repository.js";
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
let pool: Pool;
let client: Client;
let tenantA: string;
let tenantB: string;
let priceA: string;
let priceB: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_approval_expiry_worker");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  pool = new Pool({ connectionString: database.url, max: 8 });
  client = pool as unknown as Client;
  tenantA = await insertOptimizerTenant(client, "approval expiry tenant a");
  tenantB = await insertOptimizerTenant(client, "approval expiry tenant b");
  priceA = await insertActivePriceVersion(client, tenantA, "approval-expiry-price-a");
  priceB = await insertActivePriceVersion(client, tenantB, "approval-expiry-price-b");
});

afterAll(async () => {
  if (pool) await pool.end();
  await dropIsolatedDatabase(database);
});

describe("approval expiry worker", () => {
  it("expires due pending approvals and recommendations without touching future or terminal rows", async () => {
    const due = await insertApproval({
      tenantId: tenantA,
      priceVersionId: priceA,
      expiresAt: past(),
    });
    const future = await insertApproval({
      tenantId: tenantA,
      priceVersionId: priceA,
      expiresAt: "2026-08-27T00:00:00.000Z",
    });
    const rejected = await insertApproval({
      tenantId: tenantB,
      priceVersionId: priceB,
      expiresAt: past(),
      terminalStatus: "rejected",
    });

    const worker = createApprovalExpiryWorker(createApprovalsRepository(pool), {
      batchSize: 10,
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    });
    await expect(worker.processExpiredApprovals()).resolves.toEqual({
      processed: true,
      approvalIds: [due.approvalId],
      recommendationIds: [due.recommendationId],
    });

    await expect(statuses(due)).resolves.toEqual({
      approval: "expired",
      recommendation: "expired",
    });
    await expect(statuses(future)).resolves.toEqual({
      approval: "pending",
      recommendation: "pending_approval",
    });
    await expect(statuses(rejected)).resolves.toEqual({
      approval: "rejected",
      recommendation: "rejected",
    });
    await expect(worker.processExpiredApprovals()).resolves.toEqual({
      processed: false,
      approvalIds: [],
      recommendationIds: [],
    });
  });
});

async function insertApproval(input: {
  tenantId: string;
  priceVersionId: string;
  expiresAt: string;
  terminalStatus?: "rejected";
}): Promise<Readonly<{ approvalId: string; recommendationId: string }>> {
  const recommendationId = await createPendingApprovalRecommendation(
    input.tenantId,
    input.priceVersionId,
  );
  const approval = await client.query<{ id: string }>(
    `INSERT INTO approvals
       (tenant_id, recommendation_id, status, approval_snapshot, requested_at, expires_at)
     VALUES ($1, $2, 'pending', $3::jsonb, '2026-08-20T00:00:00.000Z', $4)
     RETURNING id`,
    [
      input.tenantId,
      recommendationId,
      JSON.stringify({
        contract_version: "approval_packet:v1",
        recommendation: { id: recommendationId },
        approval: { status: "pending", assigned_to: null, decision_reason: null },
      }),
      input.expiresAt,
    ],
  );
  if (input.terminalStatus) {
    await client.query(
      "UPDATE recommendations SET status = 'rejected' WHERE tenant_id = $1 AND id = $2",
      [input.tenantId, recommendationId],
    );
    await client.query(
      `UPDATE approvals
          SET status = 'rejected', decision_reason = 'Already rejected', decided_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, approval.rows[0]!.id],
    );
  }
  return { approvalId: approval.rows[0]!.id, recommendationId };
}

async function createPendingApprovalRecommendation(
  tenantId: string,
  priceVersionId: string,
): Promise<string> {
  const label = `approval-expiry-${randomUUID()}`;
  const forecast = await insertCompletedForecastRun(client, tenantId, label);
  const policy = (await insertOptimizerPolicy(client, tenantId, `approval expiry policy ${label}`))
    .rows[0]!.id;
  await client.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [policy]);
  const run = (await insertOptimizerRun(client, tenantId, forecast, policy, [priceVersionId]))
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

async function statuses(input: { approvalId: string; recommendationId: string }) {
  const result = await client.query<{ approval: string; recommendation: string }>(
    `SELECT app.status AS approval, rec.status AS recommendation
       FROM approvals app
       JOIN recommendations rec
         ON rec.tenant_id = app.tenant_id
        AND rec.id = app.recommendation_id
      WHERE app.id = $1
        AND rec.id = $2`,
    [input.approvalId, input.recommendationId],
  );
  return result.rows[0];
}

function past(): string {
  return "2026-08-25T00:00:00.000Z";
}
