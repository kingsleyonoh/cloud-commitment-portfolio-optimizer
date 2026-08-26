import { describe, expect, it, vi } from "vitest";

import { createEcosystemAdaptersService } from "../../core/adapters/ecosystem-service.js";
import type { EcosystemEventsRepository } from "../../core/adapters/ecosystem-repository.js";
import type { EcosystemEventRecord } from "../../core/adapters/ecosystem-types.js";

const config = {
  notificationHub: { enabled: true, url: "https://hub.example.test", apiKey: "hub-key" },
  workflowEngine: {
    enabled: true,
    url: "https://workflow.example.test",
    apiKey: "workflow-key",
    approvalWorkflowId: "approval-flow",
  },
  invoiceReconciliation: { enabled: false, contractVerified: false, url: "", apiKey: "" },
};

describe("ecosystem adapters", () => {
  it("creates an idempotent queued Hub event and sends the exact event contract", async () => {
    const repository = fakeRepository();
    const service = createEcosystemAdaptersService(repository, config);
    const event = await service.enqueueNotificationEvent({
      tenantId: "tenant-1",
      eventType: "cloud_commitment.approval.requested",
      eventId: "approval-1",
      payload: { status: "pending" },
    });
    expect(repository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ targetSystem: "notification_hub", enabled: true }),
    );
    expect(event.status).toBe("queued");

    const fetch = vi.fn().mockResolvedValue({ status: 202 });
    const processed = await createEcosystemAdaptersService(repository, config, {
      fetch,
    }).processNext();
    expect(processed).toMatchObject({ processed: true, status: "sent", eventId: "event-1" });
    expect(fetch).toHaveBeenCalledWith(
      "https://hub.example.test/api/events",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({
      "x-api-key": "hub-key",
      "idempotency-key": "event-1",
    });
    expect(repository.markSent).toHaveBeenCalledWith("event-row-1");
  });

  it("stores a Workflow Engine execution identifier without exposing response bodies in the ledger", async () => {
    const repository = fakeRepository("workflow_engine");
    const setExecution = vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockResolvedValue({ status: 200, json: { execution_id: "execution-42" } });
    const service = createEcosystemAdaptersService(repository, config, { fetch }, setExecution);
    await service.processNext();
    expect(fetch).toHaveBeenCalledWith(
      "https://workflow.example.test/api/workflows/approval-flow/execute",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ "x-api-key": "workflow-key" });
    expect(JSON.parse(String(init.body))).toEqual({
      event_id: "event-1",
      trigger_data: { approval_id: "approval-1" },
    });
    expect(setExecution).toHaveBeenCalledWith("tenant-1", "approval-1", "execution-42");
  });
});

function fakeRepository(
  targetSystem: "notification_hub" | "workflow_engine" = "notification_hub",
): EcosystemEventsRepository & {
  enqueue: ReturnType<typeof vi.fn>;
  markSent: ReturnType<typeof vi.fn>;
} {
  const event = Object.freeze({
    id: "event-row-1",
    tenantId: "tenant-1",
    eventType: "approval.requested",
    eventId: "event-1",
    payload: { approval_id: "approval-1" },
    status: "retrying" as const,
    targetSystem,
    nextAttemptAt: null,
    attemptCount: 1,
    lastError: null,
    createdAt: "2026-08-26T00:00:00.000000Z",
    updatedAt: "2026-08-26T00:00:00.000000Z",
  }) satisfies EcosystemEventRecord;
  const repository = {
    enqueue: vi.fn().mockResolvedValue({ ...event, status: "queued" as const }),
    listForTenant: vi.fn(),
    claimNext: vi.fn().mockResolvedValue(event),
    markSent: vi.fn().mockResolvedValue({ ...event, status: "sent" as const }),
    markRetry: vi.fn().mockResolvedValue({ ...event, status: "retrying" as const }),
    markFailed: vi.fn().mockResolvedValue({ ...event, status: "failed" as const }),
  } satisfies EcosystemEventsRepository;
  return repository as EcosystemEventsRepository & {
    enqueue: ReturnType<typeof vi.fn>;
    markSent: ReturnType<typeof vi.fn>;
  };
}
