import type { DeploymentConfig } from "./deployment.js";

export const ENV_KEYS = [
  "NODE_ENV",
  "PORT",
  "PUBLIC_BASE_URL",
  "LOG_LEVEL",
  "ALLOWED_ORIGINS",
  "DEPLOYMENT_REGION",
  "DATABASE_REGION",
  "DATABASE_URL",
  "POSTGRES_PORT",
  "DB_POOL_MAX",
  "DB_POOL_IDLE_TIMEOUT_MS",
  "DB_POOL_CONNECTION_TIMEOUT_MS",
  "REDIS_URL",
  "REDIS_PORT",
  "DUCKDB_TEMP_DIR",
  "OBJECT_STORAGE_MODE",
  "OBJECT_STORAGE_PATH",
  "SELF_REGISTRATION_ENABLED",
  "SELF_REGISTRATION_PRODUCTION_ACK",
  "REGISTRATION_LIMITER_MODE",
  "REGISTRATION_TRUSTED_PROXY_CIDRS",
  "REGISTRATION_EDGE_ENFORCES_LIMIT",
  "USERS_LIMITER_MODE",
  "USERS_TRUSTED_EDGE_ACK",
  "USERS_TRUSTED_PROXY_CIDRS",
  "DEFAULT_TENANT_NAME",
  "DEFAULT_ADMIN_EMAIL",
  "DEFAULT_ADMIN_NAME",
  "DEFAULT_ADMIN_PASSWORD_FILE",
  "API_KEY_PREFIX",
  "JWT_PRIVATE_KEY_PATH",
  "JWT_PUBLIC_KEY_PATH",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
  "JWT_ACCESS_TOKEN_MAX_LIFETIME_SECONDS",
  "JWT_CLOCK_TOLERANCE_SECONDS",
  "AUTH_ARGON_CONCURRENCY",
  "AUTH_ARGON_QUEUE_LIMIT",
  "AUTH_LIMITER_MODE",
  "AUTH_TRUSTED_PROXY_CIDRS",
  "AUTH_COOKIE_SECURE",
  "MAX_IMPORT_SIZE_MB",
  "IMPORT_WORKER_CONCURRENCY",
  "PRICE_FIXTURE_PATH",
  "PRICE_TABLE_STALE_DAYS",
  "DEFAULT_FORECAST_METHOD",
  "MIN_HISTORY_DAYS",
  "FORECAST_RANDOM_SEED",
  "FORECAST_WORKER_CONCURRENCY",
  "OPTIMIZER_MAX_CANDIDATES",
  "OPTIMIZER_TIMEOUT_SECONDS",
  "DEFAULT_DOWNSIDE_CONFIDENCE",
  "MAX_PARALLEL_OPTIMIZER_RUNS",
  "BACKTEST_MAX_MONTHS",
  "BACKTEST_WORKER_CONCURRENCY",
  "REPLAY_RANDOM_SEED",
  "REPORT_STORAGE_PATH",
  "APPROVAL_EXPIRY_HOURS",
  "NOTIFICATION_HUB_ENABLED",
  "NOTIFICATION_HUB_URL",
  "NOTIFICATION_HUB_API_KEY",
  "WORKFLOW_ENGINE_ENABLED",
  "WORKFLOW_ENGINE_URL",
  "WORKFLOW_ENGINE_API_KEY",
  "WORKFLOW_APPROVAL_WORKFLOW_ID",
  "INVOICE_RECON_ENABLED",
  "INVOICE_RECON_CONTRACT_VERIFIED",
  "INVOICE_RECON_URL",
  "INVOICE_RECON_API_KEY",
  "SENTRY_DSN",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "POSTHOG_KEY",
  "POSTHOG_HOST",
  "DEMO_MODE",
] as const;

export const DEPLOYMENT_ENV_KEYS = ["POSTGRES_PASSWORD", "APP_PUBLIC_URL"] as const;

export const TEST_ENV_KEYS = ["TEST_DATABASE_ADMIN_URL", "TEST_REDIS_URL"] as const;

export type NodeEnvironment = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type ForecastMethod =
  "seasonal_naive" | "exponential_smoothing" | "quantile_bootstrap" | "scenario_override";
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export class EnvironmentValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "ENV_VALIDATION_ERROR") {
    super(message);
    this.name = "EnvironmentValidationError";
    this.code = code;
  }
}

export interface DatabaseConfig {
  url: string;
  localPort: number;
  pool: {
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
  };
}

export interface AppConfig {
  runtime: {
    nodeEnv: NodeEnvironment;
    port: number;
    publicBaseUrl: string;
    logLevel: LogLevel;
    allowedOrigins: string[];
    demoMode: boolean;
  };
  deployment: DeploymentConfig;
  database: DatabaseConfig;
  queue: { url: string; localPort: number };
  storage: {
    duckdbTempDir: string;
    objectStorageMode: "local";
    objectStoragePath: string;
    reportStoragePath: string;
  };
  tenant: {
    selfRegistrationEnabled: boolean;
    selfRegistrationProductionAck: boolean;
    registrationLimiterMode: "local" | "redis" | "trusted_edge";
    registrationTrustedProxyCidrs: string[];
    registrationEdgeEnforcesLimit: boolean;
    defaultTenantName: string;
    defaultAdminEmail: string;
    defaultAdminName: string;
    defaultAdminPasswordFile: string;
    apiKeyPrefix: string;
  };
  users: {
    limiterMode: "local" | "redis" | "trusted_edge";
    trustedEdgeAck: boolean;
    trustedProxyCidrs: string[];
  };
  auth: {
    jwtIssuer: string;
    jwtAudience: string;
    jwtPrivateKeyPath: string;
    jwtPublicKeyPath: string;
    jwtAccessTokenMaxLifetimeSeconds: number;
    jwtClockToleranceSeconds: number;
    argonConcurrency: number;
    argonQueueLimit: number;
    limiterMode: "local" | "redis";
    trustedProxyCidrs: string[];
    cookieSecure: boolean;
  };
  imports: {
    maxSizeMb: number;
    workerConcurrency: number;
    priceFixturePath: string;
    priceTableStaleDays: number;
  };
  forecasting: {
    defaultMethod: ForecastMethod;
    minHistoryDays: number;
    randomSeed: number;
    workerConcurrency: number;
  };
  optimizer: {
    maxCandidates: number;
    timeoutSeconds: number;
    downsideConfidence: number;
    maxParallelRuns: number;
  };
  backtest: { maxMonths: number; workerConcurrency: number; randomSeed: number };
  approvals: { expiryHours: number };
  integrations: {
    notificationHub: { enabled: boolean; url: string; apiKey: string };
    workflowEngine: {
      enabled: boolean;
      url: string;
      apiKey: string;
      approvalWorkflowId: string;
    };
    invoiceReconciliation: {
      enabled: boolean;
      contractVerified: boolean;
      url: string;
      apiKey: string;
    };
  };
  observability: {
    sentryDsn: string;
    otelExporterOtlpEndpoint: string;
    posthogKey: string;
    posthogHost: string;
  };
}
