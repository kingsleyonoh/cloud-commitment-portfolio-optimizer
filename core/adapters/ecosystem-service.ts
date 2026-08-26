import { AppError } from "../shared/errors.js";
import type { EcosystemEventsRepository } from "./ecosystem-repository.js";
import type { AdapterStatus, EcosystemEventRecord, EcosystemTarget } from "./ecosystem-types.js";

export interface AdapterConfig {
  notificationHub: { enabled: boolean; url: string; apiKey: string };
  workflowEngine: { enabled: boolean; url: string; apiKey: string; approvalWorkflowId: string };
  invoiceReconciliation: {
    enabled: boolean;
    contractVerified: boolean;
    url: string;
    apiKey: string;
  };
}

export interface AdapterHttpClient {
  fetch(input: string, init: RequestInit): Promise<{ status: number; json?: unknown }>;
}

export interface EcosystemAdaptersService {
  statuses(): readonly AdapterStatus[];
  enqueueNotificationEvent(input: {
    tenantId: string;
    eventType: string;
    eventId: string;
    payload: Record<string, unknown>;
  }): Promise<EcosystemEventRecord>;
  enqueueApprovalWorkflow(input: {
    tenantId: string;
    approvalId: string;
    payload: Record<string, unknown>;
  }): Promise<EcosystemEventRecord>;
  testEvent(tenantId: string, target: EcosystemTarget): Promise<EcosystemEventRecord>;
  processNext(): Promise<
    { processed: false } | { processed: true; status: string; eventId: string }
  >;
}

export function createEcosystemAdaptersService(
  repository: EcosystemEventsRepository,
  config: AdapterConfig,
  http: AdapterHttpClient = {
    fetch: async (input, init) => {
      const response = await globalThis.fetch(input, init);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      return { status: response.status, json };
    },
  },
  setWorkflowExecutionId?: (
    tenantId: string,
    approvalId: string,
    executionId: string,
  ) => Promise<void>,
): EcosystemAdaptersService {
  return {
    statuses: () => adapterStatuses(config),
    enqueueNotificationEvent: (input) =>
      enqueue(
        repository,
        config,
        "notification_hub",
        "notification.event",
        input.eventId,
        input.tenantId,
        input.payload,
      ),
    enqueueApprovalWorkflow: (input) =>
      enqueue(
        repository,
        config,
        "workflow_engine",
        "approval.requested",
        input.approvalId,
        input.tenantId,
        {
          approval_id: input.approvalId,
          ...input.payload,
        },
      ),
    testEvent: (tenantId, target) => testEvent(repository, config, tenantId, target),
    processNext: () => processNext(repository, config, http, setWorkflowExecutionId),
  };
}

async function enqueue(
  repository: EcosystemEventsRepository,
  config: AdapterConfig,
  target: EcosystemTarget,
  eventType: string,
  eventId: string,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<EcosystemEventRecord> {
  return repository.enqueue({
    tenantId,
    eventType,
    eventId,
    payload,
    targetSystem: target,
    enabled: enabledFor(config, target),
  });
}

async function testEvent(
  repository: EcosystemEventsRepository,
  config: AdapterConfig,
  tenantId: string,
  target: EcosystemTarget,
): Promise<EcosystemEventRecord> {
  return enqueue(repository, config, target, "integration.test", `test-${target}`, tenantId, {
    message: "Cloud Commitment Portfolio Optimizer integration test",
    target_system: target,
  });
}

async function processNext(
  repository: EcosystemEventsRepository,
  config: AdapterConfig,
  http: AdapterHttpClient,
  setWorkflowExecutionId?: (
    tenantId: string,
    approvalId: string,
    executionId: string,
  ) => Promise<void>,
): Promise<{ processed: false } | { processed: true; status: string; eventId: string }> {
  const event = await repository.claimNext(new Date());
  if (!event) return { processed: false };
  try {
    const request = requestFor(config, event);
    const response = await http.fetch(request.url, request.init);
    if (response.status >= 200 && response.status < 300) {
      if (event.targetSystem === "workflow_engine" && setWorkflowExecutionId) {
        const approvalId = stringValue(event.payload.approval_id);
        const executionId = responseExecutionId(response.json);
        if (approvalId && executionId) {
          await setWorkflowExecutionId(event.tenantId, approvalId, executionId);
        }
      }
      await repository.markSent(event.id);
      return { processed: true, status: "sent", eventId: event.eventId };
    }
    if (event.attemptCount >= 5) {
      await repository.markFailed(event.id, `REMOTE_HTTP_${response.status}`);
      return { processed: true, status: "failed", eventId: event.eventId };
    }
    await repository.markRetry(
      event.id,
      new Date(Date.now() + backoffMs(event.attemptCount)),
      `REMOTE_HTTP_${response.status}`,
    );
    return { processed: true, status: "retrying", eventId: event.eventId };
  } catch {
    if (event.attemptCount >= 5) {
      await repository.markFailed(event.id, "ADAPTER_REQUEST_FAILED");
      return { processed: true, status: "failed", eventId: event.eventId };
    }
    await repository.markRetry(
      event.id,
      new Date(Date.now() + backoffMs(event.attemptCount)),
      "ADAPTER_REQUEST_FAILED",
    );
    return { processed: true, status: "retrying", eventId: event.eventId };
  }
}

function requestFor(
  config: AdapterConfig,
  event: EcosystemEventRecord,
): { url: string; init: RequestInit } {
  if (event.targetSystem === "notification_hub") {
    return {
      url: new URL("/api/events", config.notificationHub.url).toString(),
      init: jsonRequest(config.notificationHub.apiKey, event, "notification_hub"),
    };
  }
  if (event.targetSystem === "workflow_engine") {
    const workflowId = config.workflowEngine.approvalWorkflowId;
    if (!workflowId) throw unavailable("WORKFLOW_ID_MISSING");
    return {
      url: new URL(
        `/api/workflows/${encodeURIComponent(workflowId)}/execute`,
        config.workflowEngine.url,
      ).toString(),
      init: jsonRequest(config.workflowEngine.apiKey, event, "workflow_engine"),
    };
  }
  throw unavailable("ENDPOINT_CONTRACT_UNVERIFIED");
}

function jsonRequest(
  apiKey: string,
  event: EcosystemEventRecord,
  target: "notification_hub" | "workflow_engine",
): RequestInit {
  const body =
    target === "workflow_engine"
      ? { event_id: event.eventId, trigger_data: event.payload }
      : {
          event_type: event.eventType,
          event_id: event.eventId,
          tenant_id: event.tenantId,
          payload: event.payload,
        };
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "idempotency-key": event.eventId,
    },
    body: JSON.stringify(body),
  };
}

function adapterStatuses(config: AdapterConfig): readonly AdapterStatus[] {
  return [
    status(
      "notification_hub",
      config.notificationHub.enabled,
      Boolean(config.notificationHub.url && config.notificationHub.apiKey),
      "Notification Hub event mirror",
    ),
    status(
      "workflow_engine",
      config.workflowEngine.enabled,
      Boolean(
        config.workflowEngine.url &&
        config.workflowEngine.apiKey &&
        config.workflowEngine.approvalWorkflowId,
      ),
      "Workflow Engine approval trigger",
    ),
    {
      target_system: "invoice_reconciliation_engine",
      enabled: config.invoiceReconciliation.enabled,
      configured: config.invoiceReconciliation.contractVerified,
      state: config.invoiceReconciliation.enabled ? "unsupported" : "disabled",
      detail: config.invoiceReconciliation.enabled
        ? "Disabled until an exact endpoint contract is verified."
        : "No outbound calls; future adapter placeholder.",
    },
  ];
}

function status(
  target: EcosystemTarget,
  enabled: boolean,
  configured: boolean,
  detail: string,
): AdapterStatus {
  return {
    target_system: target,
    enabled,
    configured,
    state: !enabled ? "disabled" : configured ? "ready" : "degraded",
    detail,
  };
}

function enabledFor(config: AdapterConfig, target: EcosystemTarget): boolean {
  if (target === "notification_hub") return config.notificationHub.enabled;
  if (target === "workflow_engine") return config.workflowEngine.enabled;
  return false;
}

function backoffMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, attempt - 1));
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function responseExecutionId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return (
    stringValue(record.execution_id) ?? stringValue(record.executionId) ?? stringValue(record.id)
  );
}

function unavailable(code: string): AppError {
  return new AppError({
    code,
    message: "The integration adapter is unavailable.",
    statusCode: 503,
  });
}
