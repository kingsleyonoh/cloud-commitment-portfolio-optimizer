export type EcosystemTarget =
  "notification_hub" | "workflow_engine" | "invoice_reconciliation_engine";
export type EcosystemEventStatus = "queued" | "sent" | "failed" | "disabled" | "retrying";

export type EcosystemEventRecord = Readonly<{
  id: string;
  tenantId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
  status: EcosystemEventStatus;
  targetSystem: EcosystemTarget;
  nextAttemptAt: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AdapterStatus = Readonly<{
  target_system: EcosystemTarget;
  enabled: boolean;
  configured: boolean;
  state: "disabled" | "ready" | "degraded" | "unsupported";
  detail: string;
}>;
