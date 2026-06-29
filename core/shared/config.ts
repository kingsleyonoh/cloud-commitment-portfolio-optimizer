import { config as loadDotenv } from "dotenv";
import { z } from "zod";

export type NodeEnv = "development" | "test" | "production";
export type ObjectStorageMode = "local";

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

function parseBoolean(
  name: string,
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value (true/false)`);
}

function parseNumber(
  name: string,
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }

  return parsed;
}

function defaultDatabaseUrl(): string {
  const user = process.env.POSTGRES_USER ?? "ccpo";
  const password = process.env.POSTGRES_PASSWORD ?? "ccpo";
  const database = process.env.POSTGRES_DB ?? "ccpo";
  const scheme = "postgresql";
  return `${scheme}://${user}:${password}@localhost:5432/${database}`;
}

const nonEmptyString = z.string().min(1);
const optionalString = z.string();
const nodeEnvSchema = z.enum(["development", "test", "production"]);
const storageModeSchema = z.enum(["local"]);

export interface AppConfig {
  app: {
    nodeEnv: NodeEnv;
    port: number;
    publicBaseUrl: string;
    logLevel: string;
    allowedOrigins: string[];
  };
  database: {
    url: string;
    redisUrl: string;
  };
  storage: {
    duckdbTempDir: string;
    objectStorageMode: ObjectStorageMode;
    objectStoragePath: string;
    reportStoragePath: string;
  };
  tenant: {
    selfRegistrationEnabled: boolean;
    defaultTenantName: string;
    defaultAdminEmail: string;
    apiKeyPrefix: string;
    jwtPrivateKeyPath: string;
    jwtPublicKeyPath: string;
  };
  import: {
    maxImportSizeMb: number;
    workerConcurrency: number;
  };
  pricing: {
    fixturePath: string;
    priceTableStaleDays: number;
  };
  forecast: {
    defaultMethod: string;
    minHistoryDays: number;
    randomSeed: number;
    workerConcurrency: number;
  };
  optimizer: {
    maxCandidates: number;
    timeoutSeconds: number;
    defaultDownsideConfidence: number;
    maxParallelRuns: number;
  };
  replay: {
    maxMonths: number;
    randomSeed: number;
    workerConcurrency: number;
  };
  approvals: {
    expiryHours: number;
  };
  integrations: {
    notificationHub: {
      enabled: boolean;
      url: string;
      apiKey: string;
    };
    workflowEngine: {
      enabled: boolean;
      url: string;
      apiKey: string;
      approvalWorkflowId: string;
    };
    invoiceRecon: {
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

export type EnvInput = Record<string, string | undefined>;

export function loadConfig(env: EnvInput = process.env): AppConfig {
  const app = {
    nodeEnv: nodeEnvSchema.parse(env.NODE_ENV ?? "development"),
    port: parseNumber("PORT", env.PORT, 8080),
    publicBaseUrl: nonEmptyString.parse(
      env.PUBLIC_BASE_URL ?? "http://localhost:8080",
    ),
    logLevel: nonEmptyString.parse(env.LOG_LEVEL ?? "info"),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:8080")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };

  return {
    app,
    database: {
      url: nonEmptyString.parse(env.DATABASE_URL ?? defaultDatabaseUrl()),
      redisUrl: nonEmptyString.parse(env.REDIS_URL ?? "redis://localhost:6379"),
    },
    storage: {
      duckdbTempDir: nonEmptyString.parse(env.DUCKDB_TEMP_DIR ?? ".tmp/duckdb"),
      objectStorageMode: storageModeSchema.parse(
        env.OBJECT_STORAGE_MODE ?? "local",
      ),
      objectStoragePath: nonEmptyString.parse(
        env.OBJECT_STORAGE_PATH ?? ".data/objects",
      ),
      reportStoragePath: nonEmptyString.parse(
        env.REPORT_STORAGE_PATH ?? ".data/reports",
      ),
    },
    tenant: {
      selfRegistrationEnabled: parseBoolean(
        "SELF_REGISTRATION_ENABLED",
        env.SELF_REGISTRATION_ENABLED,
        true,
      ),
      defaultTenantName: nonEmptyString.parse(
        env.DEFAULT_TENANT_NAME ?? "Default",
      ),
      defaultAdminEmail: optionalString.parse(env.DEFAULT_ADMIN_EMAIL ?? ""),
      apiKeyPrefix: nonEmptyString.parse(env.API_KEY_PREFIX ?? "ccpo"),
      jwtPrivateKeyPath: optionalString.parse(env.JWT_PRIVATE_KEY_PATH ?? ""),
      jwtPublicKeyPath: optionalString.parse(env.JWT_PUBLIC_KEY_PATH ?? ""),
    },
    import: {
      maxImportSizeMb: parseNumber(
        "MAX_IMPORT_SIZE_MB",
        env.MAX_IMPORT_SIZE_MB,
        1024,
      ),
      workerConcurrency: parseNumber(
        "IMPORT_WORKER_CONCURRENCY",
        env.IMPORT_WORKER_CONCURRENCY,
        2,
      ),
    },
    pricing: {
      fixturePath: nonEmptyString.parse(
        env.PRICE_FIXTURE_PATH ?? "tests/fixtures/pricing",
      ),
      priceTableStaleDays: parseNumber(
        "PRICE_TABLE_STALE_DAYS",
        env.PRICE_TABLE_STALE_DAYS,
        90,
      ),
    },
    forecast: {
      defaultMethod: nonEmptyString.parse(
        env.DEFAULT_FORECAST_METHOD ?? "quantile_bootstrap",
      ),
      minHistoryDays: parseNumber("MIN_HISTORY_DAYS", env.MIN_HISTORY_DAYS, 90),
      randomSeed: parseNumber(
        "FORECAST_RANDOM_SEED",
        env.FORECAST_RANDOM_SEED,
        20260616,
      ),
      workerConcurrency: parseNumber(
        "FORECAST_WORKER_CONCURRENCY",
        env.FORECAST_WORKER_CONCURRENCY,
        2,
      ),
    },
    optimizer: {
      maxCandidates: parseNumber(
        "OPTIMIZER_MAX_CANDIDATES",
        env.OPTIMIZER_MAX_CANDIDATES,
        10000,
      ),
      timeoutSeconds: parseNumber(
        "OPTIMIZER_TIMEOUT_SECONDS",
        env.OPTIMIZER_TIMEOUT_SECONDS,
        30,
      ),
      defaultDownsideConfidence: parseNumber(
        "DEFAULT_DOWNSIDE_CONFIDENCE",
        env.DEFAULT_DOWNSIDE_CONFIDENCE,
        0.95,
      ),
      maxParallelRuns: parseNumber(
        "MAX_PARALLEL_OPTIMIZER_RUNS",
        env.MAX_PARALLEL_OPTIMIZER_RUNS,
        2,
      ),
    },
    replay: {
      maxMonths: parseNumber(
        "BACKTEST_MAX_MONTHS",
        env.BACKTEST_MAX_MONTHS,
        24,
      ),
      randomSeed: parseNumber(
        "REPLAY_RANDOM_SEED",
        env.REPLAY_RANDOM_SEED,
        20260616,
      ),
      workerConcurrency: parseNumber(
        "BACKTEST_WORKER_CONCURRENCY",
        env.BACKTEST_WORKER_CONCURRENCY,
        1,
      ),
    },
    approvals: {
      expiryHours: parseNumber(
        "APPROVAL_EXPIRY_HOURS",
        env.APPROVAL_EXPIRY_HOURS,
        168,
      ),
    },
    integrations: {
      notificationHub: {
        enabled: parseBoolean(
          "NOTIFICATION_HUB_ENABLED",
          env.NOTIFICATION_HUB_ENABLED,
          false,
        ),
        url: nonEmptyString.parse(
          env.NOTIFICATION_HUB_URL ?? "http://localhost:3847",
        ),
        apiKey: optionalString.parse(env.NOTIFICATION_HUB_API_KEY ?? ""),
      },
      workflowEngine: {
        enabled: parseBoolean(
          "WORKFLOW_ENGINE_ENABLED",
          env.WORKFLOW_ENGINE_ENABLED,
          false,
        ),
        url: nonEmptyString.parse(
          env.WORKFLOW_ENGINE_URL ?? "https://workflows.kingsleyonoh.com",
        ),
        apiKey: optionalString.parse(env.WORKFLOW_ENGINE_API_KEY ?? ""),
        approvalWorkflowId: optionalString.parse(
          env.WORKFLOW_APPROVAL_WORKFLOW_ID ?? "",
        ),
      },
      invoiceRecon: {
        enabled: parseBoolean(
          "INVOICE_RECON_ENABLED",
          env.INVOICE_RECON_ENABLED,
          false,
        ),
        contractVerified: parseBoolean(
          "INVOICE_RECON_CONTRACT_VERIFIED",
          env.INVOICE_RECON_CONTRACT_VERIFIED,
          false,
        ),
        url: optionalString.parse(env.INVOICE_RECON_URL ?? ""),
        apiKey: optionalString.parse(env.INVOICE_RECON_API_KEY ?? ""),
      },
    },
    observability: {
      sentryDsn: optionalString.parse(env.SENTRY_DSN ?? ""),
      otelExporterOtlpEndpoint: optionalString.parse(
        env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "",
      ),
      posthogKey: optionalString.parse(env.POSTHOG_KEY ?? ""),
      posthogHost: optionalString.parse(env.POSTHOG_HOST ?? ""),
    },
  };
}

export function loadConfigFromEnv(): AppConfig {
  loadDotenv();
  return loadConfig(process.env);
}
