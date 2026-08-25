import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertActivePriceVersion,
  insertCompletedForecastRun,
  insertOptimizerTenant,
  insertOptimizerPolicy,
  insertOptimizerRun,
  insertRecommendation,
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
let userA: string;
let recommendationA: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_report_snapshots_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertOptimizerTenant(client, "report tenant a");
  tenantB = await insertOptimizerTenant(client, "report tenant b");
  userA = (
    await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, 'reporter@example.invalid', 'Report Writer', 'tenant_admin')
       RETURNING id`,
      [tenantA],
    )
  ).rows[0]!.id;
  recommendationA = await createReadyRecommendation(tenantA);
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function createReadyRecommendation(tenantId: string): Promise<string> {
  const forecast = await insertCompletedForecastRun(client, tenantId, `report-${tenantId}`);
  const priceVersion = await insertActivePriceVersion(client, tenantId, `report-${tenantId}`);
  const policy = (await insertOptimizerPolicy(client, tenantId, `report policy ${tenantId}`))
    .rows[0]!.id;
  await client.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [policy]);
  const run = (await insertOptimizerRun(client, tenantId, forecast, policy, [priceVersion]))
    .rows[0]!.id;
  return (await insertRecommendation(client, tenantId, run)).rows[0]!.id;
}

async function insertSnapshot(overrides: Record<string, unknown> = {}) {
  return client.query<{ id: string }>(
    `INSERT INTO report_snapshots
      (tenant_id, source_type, source_id, snapshot_json, created_by_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [
      overrides.tenantId ?? tenantA,
      overrides.sourceType ?? "recommendation",
      overrides.sourceId ?? recommendationA,
      JSON.stringify(
        overrides.snapshotJson ?? {
          tenant: {
            contact: {
              email: "finance@example.invalid",
              phone: null,
              support_url: null,
              finance_owner_email: "finops@example.invalid",
            },
          },
          totals: { expected_savings_cents: "180000" },
        },
      ),
      overrides.createdByUserId ?? userA,
    ],
  );
}

describe("report snapshot freeze and lifecycle rules", () => {
  it("persists an immutable recommendation snapshot with exact tenant contact projection", async () => {
    const snapshot = await insertSnapshot();
    const stored = await client.query<{ snapshot_json: unknown }>(
      "SELECT snapshot_json FROM report_snapshots WHERE id = $1",
      [snapshot.rows[0]!.id],
    );

    expect(stored.rows[0]?.snapshot_json).toMatchObject({
      tenant: {
        contact: {
          email: "finance@example.invalid",
          phone: null,
          support_url: null,
          finance_owner_email: "finops@example.invalid",
        },
      },
      totals: { expected_savings_cents: "180000" },
    });
  });

  it("rejects cross-tenant creators and unsafe snapshot payloads", async () => {
    await expect(insertSnapshot({ tenantId: tenantB })).rejects.toMatchObject({
      constraint: "report_snapshots_tenant_user_fkey",
    });
    await expect(
      insertSnapshot({ snapshotJson: { tenant: {}, token: "approval-secret" } }),
    ).rejects.toMatchObject({ constraint: "report_snapshots_snapshot_json_object_check" });
  });

  it("freezes source identity and snapshot JSON while allowing bounded rendering state", async () => {
    const snapshot = await insertSnapshot();
    await expect(
      client.query("UPDATE report_snapshots SET snapshot_json = '{}'::jsonb WHERE id = $1", [
        snapshot.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "report snapshot identity is immutable" });
    await client.query(
      `UPDATE report_snapshots
       SET status = 'rendered', rendered_html_uri = 'object://reports/rendered.html'
       WHERE id = $1`,
      [snapshot.rows[0]!.id],
    );
    await expect(
      client.query("UPDATE report_snapshots SET source_type = 'approval' WHERE id = $1", [
        snapshot.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "report snapshot identity is immutable" });
    await client.query("UPDATE report_snapshots SET status = 'archived' WHERE id = $1", [
      snapshot.rows[0]!.id,
    ]);
  });

  it("rejects invalid states, render URIs, and deletes", async () => {
    const snapshot = await insertSnapshot();
    await expect(
      client.query("UPDATE report_snapshots SET status = 'published' WHERE id = $1", [
        snapshot.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({
      code: "55000",
      message: "invalid report snapshot status transition",
    });
    await expect(
      client.query(
        "UPDATE report_snapshots SET status = 'rendered', rendered_html_uri = '' WHERE id = $1",
        [snapshot.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ constraint: "report_snapshots_uri_text_check" });
    await expect(
      client.query("DELETE FROM report_snapshots WHERE id = $1", [snapshot.rows[0]!.id]),
    ).rejects.toMatchObject({ code: "55000", message: "report snapshots cannot be deleted" });
  });
});
