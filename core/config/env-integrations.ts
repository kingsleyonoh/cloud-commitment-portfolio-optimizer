import {
  EnvironmentValidationError,
  type AppConfig,
  type EnvironmentSource,
} from "./env-schema.js";
import {
  booleanValue,
  optionalUrl,
  requireEnabledCredential,
  urlValue,
  value,
} from "./env-values.js";

interface IntegrationFlags {
  notification: boolean;
  workflow: boolean;
  invoice: boolean;
  invoiceVerified: boolean;
}

function integrationFlags(source: EnvironmentSource): IntegrationFlags {
  return {
    notification: booleanValue(source, "NOTIFICATION_HUB_ENABLED", false),
    workflow: booleanValue(source, "WORKFLOW_ENGINE_ENABLED", false),
    invoice: booleanValue(source, "INVOICE_RECON_ENABLED", false),
    invoiceVerified: booleanValue(source, "INVOICE_RECON_CONTRACT_VERIFIED", false),
  };
}

function validateIntegrationFlags(flags: IntegrationFlags): void {
  if (flags.invoice && !flags.invoiceVerified) {
    throw new EnvironmentValidationError(
      "Invoice Reconciliation cannot be enabled before its endpoint contract is verified.",
      "ENDPOINT_CONTRACT_UNVERIFIED",
    );
  }
}

export function parseIntegrations(source: EnvironmentSource): AppConfig["integrations"] {
  const flags = integrationFlags(source);
  const notificationKey = value(source, "NOTIFICATION_HUB_API_KEY");
  const workflowKey = value(source, "WORKFLOW_ENGINE_API_KEY");
  const workflowId = value(source, "WORKFLOW_APPROVAL_WORKFLOW_ID");
  const invoiceKey = value(source, "INVOICE_RECON_API_KEY");
  validateIntegrationFlags(flags);
  requireEnabledCredential(flags.notification, notificationKey, "NOTIFICATION_HUB_API_KEY");
  requireEnabledCredential(flags.workflow, workflowKey, "WORKFLOW_ENGINE_API_KEY");
  if (flags.workflow && !workflowId) {
    throw new EnvironmentValidationError(
      "WORKFLOW_APPROVAL_WORKFLOW_ID is required when the Workflow Engine is enabled.",
    );
  }
  requireEnabledCredential(flags.invoice, invoiceKey, "INVOICE_RECON_API_KEY");
  return {
    notificationHub: {
      enabled: flags.notification,
      url: urlValue(source, "NOTIFICATION_HUB_URL", "http://localhost:3847", ["http:", "https:"]),
      apiKey: notificationKey,
    },
    workflowEngine: {
      enabled: flags.workflow,
      url: urlValue(source, "WORKFLOW_ENGINE_URL", "https://workflows.kingsleyonoh.com", [
        "http:",
        "https:",
      ]),
      apiKey: workflowKey,
      approvalWorkflowId: workflowId,
    },
    invoiceReconciliation: {
      enabled: flags.invoice,
      contractVerified: flags.invoiceVerified,
      url: optionalUrl(source, "INVOICE_RECON_URL"),
      apiKey: invoiceKey,
    },
  };
}

export function parseObservability(source: EnvironmentSource): AppConfig["observability"] {
  return {
    sentryDsn: optionalUrl(source, "SENTRY_DSN"),
    otelExporterOtlpEndpoint: optionalUrl(source, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    posthogKey: value(source, "POSTHOG_KEY"),
    posthogHost: optionalUrl(source, "POSTHOG_HOST"),
  };
}
