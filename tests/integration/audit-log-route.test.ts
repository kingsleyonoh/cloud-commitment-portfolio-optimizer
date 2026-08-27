import { afterEach, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeOptimizerRunsHarness,
  createOptimizerRunsHarness,
  optimizerRunsAuthorization,
  type OptimizerRunsHarness,
} from "./helpers/optimizer-runs-app.js";

let harness: OptimizerRunsHarness | undefined;

afterEach(async () => {
  await closeOptimizerRunsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
  harness = undefined;
});

describe("audit log route", () => {
  it("lists tenant-scoped append-only evidence with filters, cursors, and safe values", async () => {
    harness = await createOptimizerRunsHarness("ccpo_audit_route");
    await insertAudit(
      harness.tenantA,
      harness.actors.get("tenant_admin")!,
      "2026-08-26T00:00:00Z",
      {
        action: "api_key.rotated",
        entityType: "api_key",
        newValues: { result: "succeeded", secret: "must-not-render" },
      },
    );
    const older = await insertAudit(
      harness.tenantA,
      harness.actors.get("finops_analyst")!,
      "2026-08-25T00:00:00Z",
      { action: "user.login.succeeded", entityType: "user", newValues: { result: "succeeded" } },
    );
    await insertAudit(harness.tenantB, null, "2026-08-27T00:00:00Z", {
      action: "foreign.event",
      entityType: "tenant",
      actorType: "system",
    });

    const first = await harness.app.inject({
      method: "GET",
      url: "/api/audit-log?limit=1",
      headers: optimizerRunsAuthorization(harness, "tenant_admin", "tenant_admin"),
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as {
      audit: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
    expect(body.audit).toHaveLength(1);
    expect(body.audit[0]).toMatchObject({ action: "api_key.rotated", entity_type: "api_key" });
    expect(body.audit[0]?.new_values).toEqual({ result: "succeeded" });
    expect(body.audit[0]).not.toHaveProperty("tenant_id");
    expect(body.next_cursor).toEqual(expect.any(String));

    const next = await harness.app.inject({
      method: "GET",
      url: `/api/audit-log?limit=1&cursor=${encodeURIComponent(body.next_cursor!)}`,
      headers: optimizerRunsAuthorization(harness, "read_only_auditor", "read_only_auditor"),
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().audit).toEqual([expect.objectContaining({ id: older.id })]);

    const filtered = await harness.app.inject({
      method: "GET",
      url: "/api/audit-log?action=api_key.rotated",
      headers: optimizerRunsAuthorization(harness, "read_only_auditor", "read_only_auditor"),
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().audit).toHaveLength(1);
    expect(filtered.body).not.toContain("foreign.event");
  });

  it("protects the audit endpoint for Tenant Admin and Read-only Auditor only", async () => {
    harness = await createOptimizerRunsHarness("ccpo_audit_auth");
    const approver = await harness.app.inject({
      method: "GET",
      url: "/api/audit-log",
      headers: optimizerRunsAuthorization(harness, "finance_approver", "finance_approver"),
    });
    expect(approver.statusCode).toBe(403);
    const apiKey = await harness.app.inject({
      method: "GET",
      url: "/api/audit-log",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(apiKey.statusCode).toBe(403);
  });

  it("renders the responsive audit view and filter/export controls", async () => {
    harness = await createOptimizerRunsHarness("ccpo_audit_ui");
    await insertAudit(
      harness.tenantA,
      harness.actors.get("tenant_admin")!,
      "2026-08-26T00:00:00Z",
      {
        action: "user.login.succeeded",
        entityType: "user",
        newValues: { result: "succeeded" },
      },
    );
    const response = await harness.app.inject({
      method: "GET",
      url: "/audit-log?action=user.login.succeeded",
      headers: {
        accept: "text/html",
        ...optimizerRunsAuthorization(harness, "read_only_auditor", "read_only_auditor"),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Audit log");
    expect(response.body).toContain("Export JSON");
    expect(response.body).toContain("user.login.succeeded");
    expect(response.body).not.toMatch(/<script|tenant_id|password|secret|authorization|Bearer/iu);
  });
});

async function insertAudit(
  tenantId: string,
  actorUserId: string | null,
  createdAt: string,
  input: {
    action: string;
    entityType: string;
    newValues?: Record<string, unknown>;
    actorType?: "user" | "system";
  },
): Promise<{ id: string }> {
  const actorType = input.actorType ?? "user";
  const result = await harness!.pool.query<{ id: string }>(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, actor_type, action, entity_type, new_values, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $7::timestamptz)
     RETURNING id`,
    [
      tenantId,
      actorUserId,
      actorType,
      input.action,
      input.entityType,
      JSON.stringify(input.newValues ?? {}),
      createdAt,
    ],
  );
  return result.rows[0]!;
}
