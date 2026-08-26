import type { AddressInfo } from "node:net";
import type { AppConfig } from "../../core/config/env.js";
import { createDashboardRepository } from "../../core/dashboard/dashboard-repository.js";
import { createDashboardService } from "../../core/dashboard/dashboard-service.js";
import { createImportsRepository } from "../../core/imports/imports-repository.js";
import { createImportsService } from "../../core/imports/imports-service.js";
import { createForecastRepository } from "../../core/forecasting/forecast-repository.js";
import { createForecastService } from "../../core/forecasting/forecast-service.js";
import { createOptimizerPoliciesRepository } from "../../core/optimizer-policies/optimizer-policies-repository.js";
import { createOptimizerPoliciesService } from "../../core/optimizer-policies/optimizer-policies-service.js";
import { createOptimizerRunsRepository } from "../../core/optimizer-runs/optimizer-runs-repository.js";
import { createOptimizerRunsService } from "../../core/optimizer-runs/optimizer-runs-service.js";
import { createPriceTablesRepository } from "../../core/price-tables/price-tables-repository.js";
import { createPriceTablesService } from "../../core/price-tables/price-tables-service.js";
import { createRecommendationsRepository } from "../../core/recommendations/recommendations-repository.js";
import { createRecommendationsService } from "../../core/recommendations/recommendations-service.js";
import { createReportsRepository } from "../../core/reports/reports-repository.js";
import { createReportsService } from "../../core/reports/reports-service.js";
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
      service: createImportsService(createImportsRepository(database.pool), objectStore, logger),
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
