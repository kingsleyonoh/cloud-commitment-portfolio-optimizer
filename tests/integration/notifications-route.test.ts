import { afterEach, describe, expect, it } from "vitest";

import { createNotificationsRepository } from "../../core/notifications/notifications-repository.js";
import { createNotificationsService } from "../../core/notifications/notifications-service.js";
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

describe("local notifications", () => {
  it("keeps notification rows tenant/user scoped, honors low opt-out, and marks read", async () => {
    harness = await createOptimizerRunsHarness("ccpo_notifications_routes");
    const service = createNotificationsService(createNotificationsRepository(harness.pool));
    const analystId = harness.actors.get("finops_analyst")!;
    const event = {
      tenantId: harness.tenantA,
      eventType: "cloud_commitment.import.completed",
      eventId: "import-1",
      sourceType: "import_batch" as const,
      sourceId: null,
      templateName: "import_completed",
      urgency: "low" as const,
      payload: { line_count: "12" },
      recipientUserIds: [analystId],
    };

    await expect(service.emit(event)).resolves.toHaveLength(1);
    await expect(service.emit(event)).resolves.toHaveLength(0);
    await service.updatePreferences(
      {
        tenantId: harness.tenantA,
        actorType: "user",
        actorUserId: analystId,
        apiKeyId: null,
        role: "finops_analyst",
        requestId: "request-1",
      },
      {
        preferences: [
          {
            event_type: event.eventType,
            channel: "in_app",
            urgency: "low",
            enabled: false,
          },
        ],
      },
    );
    await expect(service.emit({ ...event, eventId: "import-2" })).resolves.toHaveLength(0);

    const listed = await harness.app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: optimizerRunsAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ unread_count: 1, notifications: [{ status: "unread" }] });
    const id = listed.json().notifications[0].id as string;
    const marked = await harness.app.inject({
      method: "POST",
      url: `/api/notifications/${id}/read`,
      headers: optimizerRunsAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({ status: "read" });
  });

  it("requires an admin lock before muting a high-urgency approval notification", async () => {
    harness = await createOptimizerRunsHarness("ccpo_notifications_policy");
    const analyst = optimizerRunsAuthorization(harness, "finops_analyst", "finops_analyst");
    const high = {
      preferences: [
        {
          event_type: "cloud_commitment.approval.requested",
          channel: "in_app",
          urgency: "high",
          enabled: false,
        },
      ],
    };
    const denied = await harness.app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      headers: { "content-type": "application/json", ...analyst },
      payload: high,
    });
    expect(denied.statusCode).toBe(409);
    const admin = await harness.app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      headers: {
        "content-type": "application/json",
        ...optimizerRunsAuthorization(harness),
      },
      payload: { preferences: [{ ...high.preferences[0], locked_by_admin: true }] },
    });
    expect(admin.statusCode).toBe(200);
    const service = createNotificationsService(createNotificationsRepository(harness.pool));
    const emitted = await service.emit({
      tenantId: harness.tenantA,
      eventType: "cloud_commitment.approval.requested",
      eventId: "approval-1",
      sourceType: "approval",
      sourceId: null,
      templateName: "approval_requested",
      urgency: "high",
      payload: {
        instrument: "aws_compute_savings_plan",
        expected_savings_cents: "100",
        p95_downside_loss_cents: "20",
      },
      recipientUserIds: [harness.actors.get("tenant_admin")!],
    });
    expect(emitted).toHaveLength(0);
  });

  it("does not expose API-key actors to notification endpoints", async () => {
    harness = await createOptimizerRunsHarness("ccpo_notifications_auth");
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(response.statusCode).toBe(403);
  });
});
