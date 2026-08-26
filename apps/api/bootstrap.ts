import type { AddressInfo } from "node:net";
import type { ApprovalRecord } from "../../core/approvals/approvals-types.js";
import type { EcosystemAdaptersService } from "../../core/adapters/ecosystem-service.js";
import type { AppConfig } from "../../core/config/env.js";
import { createApprovalsRepository } from "../../core/approvals/approvals-repository.js";
import { createApprovalsService } from "../../core/approvals/approvals-service.js";
import { createBacktestsRepository } from "../../core/backtests/backtests-repository.js";
import { createBacktestsService } from "../../core/backtests/backtests-service.js";
import { createDashboardRepository } from "../../core/dashboard/dashboard-repository.js";
import { createDashboardService } from "../../core/dashboard/dashboard-service.js";
import { createImportsRepository } from "../../core/imports/imports-repository.js";
import { createImportsService } from "../../core/imports/imports-service.js";
import type { ImportBatchRecord } from "../../core/imports/imports-types.js";
import { createForecastRepository } from "../../core/forecasting/forecast-repository.js";
import { createForecastService } from "../../core/forecasting/forecast-service.js";
import { createOptimizerPoliciesRepository } from "../../core/optimizer-policies/optimizer-policies-repository.js";
import { createOptimizerPoliciesService } from "../../core/optimizer-policies/optimizer-policies-service.js";
import { createOptimizerRunsRepository } from "../../core/optimizer-runs/optimizer-runs-repository.js";
import { createOptimizerRunsService } from "../../core/optimizer-runs/optimizer-runs-service.js";
import { createNotificationsRepository } from "../../core/notifications/notifications-repository.js";
import { createNotificationsService } from "../../core/notifications/notifications-service.js";
import type { NotificationsService } from "../../core/notifications/notifications-service.js";
import { createEcosystemEventsRepository } from "../../core/adapters/ecosystem-repository.js";
import { createEcosystemAdaptersService } from "../../core/adapters/ecosystem-service.js";
import { createPriceTablesRepository } from "../../core/price-tables/price-tables-repository.js";
import { createPriceTablesService } from "../../core/price-tables/price-tables-service.js";
import { createRecommendationsRepository } from "../../core/recommendations/recommendations-repository.js";
import { createRecommendationsService } from "../../core/recommendations/recommendations-service.js";
import { createReportsRepository } from "../../core/reports/reports-repository.js";
import { createReportsService } from "../../core/reports/reports-service.js";
import { createScenariosRepository } from "../../core/scenarios/scenarios-repository.js";
import { createScenariosService } from "../../core/scenarios/scenarios-service.js";
import { getEnvironmentConfig } from "../../core/config/env.js";
import { getDbPool, type DbPoolResource } from "../../core/shared/db.js";
import type { Logger } from "../../core/shared/logger.js";
import { getLogger } from "../../core/shared/logger.js";
import { getObjectStore, type ObjectStore } from "../../core/shared/objectStore.js";
import { createApiKeyMetadataRepository } from "../../core/tenant/api-key-metadata-repository.js";
import { createApiKeyMetadataService } from "../../core/tenant/api-key-metadata-service.js";
import { createApiKeyRotationRepository } from "../../core/tenant/api-key-rotation-repository.js";
import { createApiKeyRotationService } from "../../core/tenant/api-key-rotation-service.js";
import { createCloudAccountsRepository } from "../../core/tenant/cloud-accounts-repository.js";
import { createCloudAccountsService } from "../../core/tenant/cloud-accounts-service.js";
import {
  getRegistrationLimiter,
  type RegistrationLimiter,
  type RegistrationLimiterConfig,
} from "../../core/tenant/registration-limiter.js";
import { createTenantRegistrationService } from "../../core/tenant/registration-service.js";
import { createTenantProfileRepository } from "../../core/tenant/profile-repository.js";
import { createTenantProfileService } from "../../core/tenant/profile-service.js";
import {
  getProtectedUsersLimiter,
  type ProtectedUsersLimiter,
  type ProtectedUsersLimiterConfig,
} from "../../core/tenant/protected-users-limiter.js";
import { buildApp, type BuildAppOptions } from "./app.js";
import { createAuditRepository } from "../../core/audit/audit-repository.js";
import { createAuditService } from "../../core/audit/audit-service.js";
import {
  closeAuthenticationRuntime,
  createAuthenticationRuntime,
} from "./authentication-runtime.js";
import type { AuthenticationRuntime } from "./plugins/auth.js";
import { createRuntimeCloser, type CloseableApplication, type ResourceName } from "./resources.js";
import { createUsersRuntime } from "./users-runtime.js";

export interface ApplicationInstance extends CloseableApplication {
  listen(options: { host: string; port: number }): Promise<string>;
  server: { address(): AddressInfo | string | null };
}

export interface RunningRuntime {
  app: ApplicationInstance;
  host: string;
  port: number;
  close(): Promise<void>;
}

export interface BootstrapOptions {
  host?: string;
  port?: number;
  getConfig?: () => Promise<Readonly<AppConfig>>;
  getLogger?: () => Promise<Logger>;
  getDatabase?: (config: AppConfig["database"]) => Promise<DbPoolResource>;
  createAuthentication?: (
    config: Readonly<AppConfig>,
    database: DbPoolResource,
  ) => Promise<AuthenticationRuntime>;
  createRegistrationLimiter?: (config: RegistrationLimiterConfig) => Promise<RegistrationLimiter>;
  createUsersLimiter?: (config: ProtectedUsersLimiterConfig) => Promise<ProtectedUsersLimiter>;
  getObjectStore?: (rootPath: string) => Promise<ObjectStore>;
  buildApplication?: (options: BuildAppOptions) => ApplicationInstance;
  createCloser?: (
    app: CloseableApplication | undefined,
    initialized: ReadonlySet<ResourceName>,
  ) => () => Promise<void>;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<RunningRuntime> {
  const initialized = new Set<ResourceName>();
  let app: ApplicationInstance | undefined;
  let authentication: AuthenticationRuntime | undefined;
  let close: (() => Promise<void>) | undefined;
  try {
    const config = await (options.getConfig ?? getEnvironmentConfig)();
    initialized.add("environment");
    const logger = await (options.getLogger ?? getLogger)();
    initialized.add("logger");
    const database = await (options.getDatabase ?? getDbPool)(config.database);
    initialized.add("database");
    const registrationLimiter = await acquireRegistrationLimiter(config, options, initialized);
    const usersLimiter = await acquireUsersLimiter(config, options, initialized);
    authentication = await acquireAuthentication(config, database, options);
    const objectStore = await acquireObjectStore(config, options, initialized);
    const appOptions = applicationOptions(
      config,
      logger,
      database,
      objectStore,
      authentication,
      registrationLimiter,
      usersLimiter,
    );
    app = (options.buildApplication ?? buildApp)(appOptions);
    close = (options.createCloser ?? createRuntimeCloser)(app, initialized);
    const host = options.host ?? hostFor(config.runtime.nodeEnv);
    const port = options.port ?? config.runtime.port;
    await app.listen({ host, port });
    const actualPort = listeningPort(app);
    await logger.info("listening", { host, port: actualPort });
    return { app, host, port: actualPort, close };
  } catch (error) {
    close ??= (options.createCloser ?? createRuntimeCloser)(app, initialized);
    const closeUnboundAuth = app ? undefined : () => closeAuthenticationRuntime(authentication);
    await closeAfterFailure(close, error, closeUnboundAuth);
    throw error;
  }
}

async function acquireObjectStore(
  config: Readonly<AppConfig>,
  options: BootstrapOptions,
  initialized: Set<ResourceName>,
): Promise<ObjectStore> {
  const store = await (options.getObjectStore ?? getObjectStore)(config.storage.objectStoragePath);
  initialized.add("objectStore");
  return store;
}

function acquireAuthentication(
  config: Readonly<AppConfig>,
  database: DbPoolResource,
  options: BootstrapOptions,
): Promise<AuthenticationRuntime> {
  return (options.createAuthentication ?? createAuthenticationRuntime)(config, database);
}

async function acquireRegistrationLimiter(
  config: Readonly<AppConfig>,
  options: BootstrapOptions,
  initialized: Set<ResourceName>,
): Promise<RegistrationLimiter | undefined> {
  if (!config.tenant?.selfRegistrationEnabled) return undefined;
  const limiter = await (options.createRegistrationLimiter ?? getRegistrationLimiter)({
    mode: config.tenant.registrationLimiterMode,
    redisUrl: config.queue.url,
  });
  initialized.add("registrationLimiter");
  return limiter;
}

async function acquireUsersLimiter(
  config: Readonly<AppConfig>,
  options: BootstrapOptions,
  initialized: Set<ResourceName>,
): Promise<ProtectedUsersLimiter> {
  const mode = config.users?.limiterMode ?? "local";
  const limiter = await (options.createUsersLimiter ?? getProtectedUsersLimiter)({
    mode,
    redisUrl: config.queue?.url ?? "redis://127.0.0.1:6379",
  });
  initialized.add("usersLimiter");
  return limiter;
}

function applicationOptions(
  config: Readonly<AppConfig>,
  logger: Logger,
  database: DbPoolResource,
  objectStore: ObjectStore,
  authentication: AuthenticationRuntime,
  limiter: RegistrationLimiter | undefined,
  usersLimiter: ProtectedUsersLimiter,
): BuildAppOptions {
  const approvalsRepository = createApprovalsRepository(database.pool);
  const importsRepository = createImportsRepository(database.pool);
  const ecosystemRepository = createEcosystemEventsRepository(database.pool);
  const notificationsService = createNotificationsService(
    createNotificationsRepository(database.pool),
  );
  const integrationsService = createEcosystemAdaptersService(
    ecosystemRepository,
    config.integrations,
    undefined,
    (tenantId, approvalId, executionId) =>
      approvalsRepository.setWorkflowExecutionId(tenantId, approvalId, executionId),
  );
  const approvalsService = createApprovalsService(approvalsRepository, {
    expiryHours: config.approvals?.expiryHours ?? 168,
    onApprovalRequested: ({ tenantId, approval }) =>
      emitApprovalRequestedEvents(
        notificationsService,
        integrationsService,
        config.runtime.publicBaseUrl,
        tenantId,
        approval,
      ),
    onApprovalDecided: ({ tenantId, approval }) =>
      emitApprovalDecidedNotification(notificationsService, tenantId, approval),
  });
  const importsService = createImportsService(importsRepository, objectStore, logger, {
    onImportProcessed: ({ tenantId, batch }) =>
      emitImportProcessedEvents(notificationsService, integrationsService, tenantId, batch),
  });
  return {
    logger,
    databaseProbe: () => database.health(),
    databaseTimeoutMs: Math.min(config.database.pool.connectionTimeoutMillis, 5000),
    authentication,
    tenantProfile: {
      service: createTenantProfileService(createTenantProfileRepository(database.pool)),
    },
    users: createUsersRuntime(
      database,
      logger,
      usersLimiter,
      config.auth,
      authentication.sessions?.argonExecutor,
    ),
    apiKeys: {
      limiter: usersLimiter,
      service: createApiKeyMetadataService(createApiKeyMetadataRepository(database.pool)),
    },
    apiKeyRotation: {
      limiter: usersLimiter,
      service: createApiKeyRotationService(
        createApiKeyRotationRepository(database.pool),
        config.tenant?.apiKeyPrefix ?? "ccpo",
      ),
    },
    cloudAccounts: {
      limiter: usersLimiter,
      service: createCloudAccountsService(createCloudAccountsRepository(database.pool), logger),
    },
    dashboard: {
      service: createDashboardService(createDashboardRepository(database.pool)),
    },
    imports: {
      limiter: usersLimiter,
      service: importsService,
    },
    priceTables: {
      limiter: usersLimiter,
      service: createPriceTablesService(createPriceTablesRepository(database.pool), {
        staleDays: config.imports?.priceTableStaleDays ?? 90,
      }),
    },
    forecasts: {
      limiter: usersLimiter,
      service: createForecastService(createForecastRepository(database.pool), {
        defaultSeed: BigInt(config.forecasting?.randomSeed ?? 20_260_616),
      }),
    },
    optimizerPolicies: {
      limiter: usersLimiter,
      service: createOptimizerPoliciesService(createOptimizerPoliciesRepository(database.pool)),
    },
    optimizerRuns: {
      limiter: usersLimiter,
      service: createOptimizerRunsService(
        createOptimizerRunsRepository(database.pool),
        objectStore,
        { defaultSeed: 20_260_616n },
      ),
    },
    recommendations: {
      limiter: usersLimiter,
      service: createRecommendationsService(createRecommendationsRepository(database.pool)),
    },
    approvals: {
      limiter: usersLimiter,
      service: approvalsService,
    },
    backtests: {
      limiter: usersLimiter,
      service: createBacktestsService(createBacktestsRepository(database.pool), objectStore, {
        maxMonths: config.backtest?.maxMonths ?? 24,
        defaultSeed: BigInt(config.backtest?.randomSeed ?? 20_260_616),
      }),
    },
    notifications: {
      limiter: usersLimiter,
      service: notificationsService,
    },
    integrations: {
      limiter: usersLimiter,
      service: integrationsService,
    },
    scenarios: {
      limiter: usersLimiter,
      service: createScenariosService(createScenariosRepository(database.pool)),
    },
    auditLog: {
      limiter: usersLimiter,
      service: createAuditService(createAuditRepository(database.pool)),
    },
    reports: {
      limiter: usersLimiter,
      service: createReportsService(createReportsRepository(database.pool), objectStore),
    },
    ...(config.tenant?.registrationTrustedProxyCidrs
      ? { registrationTrustedProxyCidrs: config.tenant.registrationTrustedProxyCidrs }
      : {}),
    ...registrationRuntime(config, database, limiter),
  };
}

function registrationRuntime(
  config: Readonly<AppConfig>,
  database: DbPoolResource,
  limiter: RegistrationLimiter | undefined,
): Pick<BuildAppOptions, "tenantRegistration"> {
  if (!limiter) return {};
  return {
    tenantRegistration: {
      limiter,
      service: createTenantRegistrationService(database.pool, config.tenant.apiKeyPrefix),
    },
  };
}

async function emitApprovalRequestedEvents(
  notifications: NotificationsService,
  integrations: EcosystemAdaptersService,
  publicBaseUrl: string,
  tenantId: string,
  approval: ApprovalRecord,
): Promise<void> {
  const recommendation = objectValue(approval.approvalSnapshot.recommendation);
  const approvalSnapshot = objectValue(approval.approvalSnapshot.approval);
  const recipients = approval.assignedToUserId
    ? { recipientUserIds: [approval.assignedToUserId] }
    : { recipientRoles: ["finance_approver", "tenant_admin"] };
  const payload = {
    instrument: stringValue(recommendation.instrument),
    expected_savings_cents: stringValue(recommendation.expected_savings_cents),
    p95_downside_loss_cents: stringValue(recommendation.p95_downside_loss_cents),
  };
  await Promise.allSettled([
    notifications.emit({
      tenantId,
      eventType: "cloud_commitment.approval.requested",
      eventId: approval.id,
      sourceType: "approval",
      sourceId: approval.id,
      templateName: "approval_requested",
      urgency: "high",
      payload,
      ...recipients,
    }),
    integrations.enqueueApprovalWorkflow({
      tenantId,
      approvalId: approval.id,
      payload: {
        approval_snapshot_id: approval.id,
        recommendation_summary: {
          provider: stringValue(recommendation.provider),
          instrument: stringValue(recommendation.instrument),
          service_code: stringValue(recommendation.service_code),
          region: stringValue(recommendation.region),
          term_months: numberValue(recommendation.term_months),
          expected_savings_cents: stringValue(recommendation.expected_savings_cents),
          p95_downside_loss_cents: stringValue(recommendation.p95_downside_loss_cents),
        },
        approver_email: stringValue(approvalSnapshot.assigned_to),
        amount_cents: stringValue(recommendation.commitment_amount_cents),
        risk_band: stringValue(recommendation.risk_band),
        callback_url: `${publicBaseUrl}/api/approvals/${approval.id}`,
      },
    }),
  ]);
}

async function emitApprovalDecidedNotification(
  notifications: NotificationsService,
  tenantId: string,
  approval: ApprovalRecord,
): Promise<void> {
  await notifications.emit({
    tenantId,
    eventType: "cloud_commitment.approval.decided",
    eventId: `${approval.id}:${approval.status}`,
    sourceType: "approval",
    sourceId: approval.id,
    templateName: "approval_decided",
    urgency: "medium",
    payload: {
      status: approval.status,
      decision_reason: approval.decisionReason ?? "No reason supplied.",
    },
    ...(approval.assignedToUserId
      ? { recipientUserIds: [approval.assignedToUserId] }
      : { recipientRoles: ["finance_approver", "tenant_admin"] }),
  });
}

async function emitImportProcessedEvents(
  notifications: NotificationsService,
  integrations: EcosystemAdaptersService,
  tenantId: string,
  batch: ImportBatchRecord,
): Promise<void> {
  const quarantined = batch.status === "quarantined";
  const eventType = quarantined
    ? "cloud_commitment.import.quarantined"
    : "cloud_commitment.import.completed";
  const reason = quarantined ? importReason(batch.errorDetails) : "";
  const payload = {
    status: batch.status,
    source: batch.source,
    format: batch.format,
    line_count: batch.lineCount,
    ...(quarantined ? { reason } : {}),
  };
  await Promise.allSettled([
    notifications.emit({
      tenantId,
      eventType,
      eventId: batch.id,
      sourceType: "import_batch",
      sourceId: batch.id,
      templateName: quarantined ? "import_quarantined" : "import_completed",
      urgency: quarantined ? "medium" : "low",
      payload,
    }),
    integrations.enqueueNotificationEvent({
      tenantId,
      eventType,
      eventId: batch.id,
      payload,
    }),
  ]);
}

function importReason(errorDetails: Record<string, unknown>): string {
  const reason = errorDetails.message ?? errorDetails.code;
  return typeof reason === "string" && reason.trim() ? reason : "Parser review required.";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | string {
  return typeof value === "number" || typeof value === "string" ? value : "";
}

export { createAuthenticationRuntime };

function hostFor(nodeEnv: AppConfig["runtime"]["nodeEnv"]): string {
  return nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1";
}

function listeningPort(app: ApplicationInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("The API server did not expose a TCP listening address.");
  }
  return address.port;
}

async function closeAfterFailure(
  close: () => Promise<void>,
  primary: unknown,
  closeUnboundAuth?: () => Promise<void>,
): Promise<void> {
  const cleanupFailures: unknown[] = [];
  try {
    await closeUnboundAuth?.();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError([primary, ...cleanupFailures], "API startup and cleanup failed.", {
      cause: primary,
    });
  }
}
