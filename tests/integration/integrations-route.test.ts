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

describe("integration adapter routes", () => {
  it("reports disabled adapters and records a disabled test event without outbound HTTP", async () => {
    harness = await createOptimizerRunsHarness("ccpo_integrations_disabled");
    const headers = optimizerRunsAuthorization(harness);
    const status = await harness.app.inject({
      method: "GET",
      url: "/api/integrations/status",
      headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target_system: "notification_hub", state: "disabled" }),
        expect.objectContaining({ target_system: "workflow_engine", state: "disabled" }),
        expect.objectContaining({
          target_system: "invoice_reconciliation_engine",
          state: "disabled",
        }),
      ]),
    );

    const testEvent = await harness.app.inject({
      method: "POST",
      url: "/api/integrations/test-event",
      headers: { "content-type": "application/json", ...headers },
      payload: { target_system: "notification_hub" },
    });
    expect(testEvent.statusCode).toBe(201);
    expect(testEvent.json()).toMatchObject({
      status: "disabled",
      target_system: "notification_hub",
      event_id: "test-notification_hub",
    });
    const rows = await harness.pool.query(
      "SELECT status, target_system FROM ecosystem_events WHERE tenant_id = $1",
      [harness.tenantA],
    );
    expect(rows.rows).toEqual([{ status: "disabled", target_system: "notification_hub" }]);
  });

  it("keeps adapter configuration tenant-admin-only", async () => {
    harness = await createOptimizerRunsHarness("ccpo_integrations_auth");
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/integrations/status",
      headers: optimizerRunsAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(response.statusCode).toBe(403);
  });
});
