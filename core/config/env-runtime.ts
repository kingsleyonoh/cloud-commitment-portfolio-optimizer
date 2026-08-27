export { parseAuth } from "./auth.js";

import {
  EnvironmentValidationError,
  type AppConfig,
  type EnvironmentSource,
  type NodeEnvironment,
} from "./env-schema.js";
import {
  booleanValue,
  integerValue,
  networkFallback,
  oneOf,
  required,
  urlValue,
} from "./env-values.js";
import { parseRegistrationConfig } from "./registration.js";

function publicBaseUrl(source: EnvironmentSource, production: boolean): string {
  const result = urlValue(
    source,
    "PUBLIC_BASE_URL",
    networkFallback(production, "http://localhost:8080"),
    ["http:", "https:"],
  );
  const hostname = new URL(result).hostname.toLowerCase();
  const parsed = new URL(result);
  if (production && parsed.protocol !== "https:") {
    throw new EnvironmentValidationError("PUBLIC_BASE_URL must use HTTPS in production.");
  }
  if (production && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new EnvironmentValidationError(
      "PUBLIC_BASE_URL must not use a loopback host in production.",
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new EnvironmentValidationError("PUBLIC_BASE_URL must be an exact origin URL.");
  }
  return parsed.origin;
}

function poolInteger(
  source: EnvironmentSource,
  key: string,
  production: boolean,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (production) required(source, key);
  return integerValue(source, key, fallback, minimum, maximum);
}

function parseOrigins(source: EnvironmentSource, production: boolean): string[] {
  const origins = required(
    source,
    "ALLOWED_ORIGINS",
    networkFallback(production, "http://localhost:8080"),
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    try {
      new URL(origin);
    } catch {
      throw new EnvironmentValidationError("ALLOWED_ORIGINS must contain valid URLs.");
    }
  }
  return origins;
}

export function parseRuntime(
  source: EnvironmentSource,
  nodeEnv: NodeEnvironment,
): AppConfig["runtime"] {
  const production = nodeEnv === "production";
  const port = integerValue(source, "PORT", 8080, 0, 65_535);
  if (production && port === 0) {
    throw new EnvironmentValidationError("PORT must be between 1 and 65535 in production.");
  }
  return {
    nodeEnv,
    port,
    publicBaseUrl: publicBaseUrl(source, production),
    logLevel: oneOf(source, "LOG_LEVEL", ["debug", "info", "warn", "error"] as const, "info"),
    allowedOrigins: parseOrigins(source, production),
    demoMode: booleanValue(source, "DEMO_MODE", true),
  };
}

function parseDatabasePool(
  source: EnvironmentSource,
  production: boolean,
): AppConfig["database"]["pool"] {
  return {
    max: poolInteger(source, "DB_POOL_MAX", production, 10, 1, 100),
    idleTimeoutMillis: poolInteger(
      source,
      "DB_POOL_IDLE_TIMEOUT_MS",
      production,
      10_000,
      1_000,
      300_000,
    ),
    connectionTimeoutMillis: poolInteger(
      source,
      "DB_POOL_CONNECTION_TIMEOUT_MS",
      production,
      5_000,
      250,
      60_000,
    ),
  };
}

function parseDatabase(source: EnvironmentSource, production: boolean): AppConfig["database"] {
  return {
    url: urlValue(
      source,
      "DATABASE_URL",
      networkFallback(production, "postgresql://user@localhost:5432/ccpo"),
      ["postgres:", "postgresql:"],
    ),
    localPort: integerValue(source, "POSTGRES_PORT", 5432, 1, 65_535),
    pool: parseDatabasePool(source, production),
  };
}

export function parseConnections(
  source: EnvironmentSource,
  production: boolean,
): Pick<AppConfig, "database" | "queue"> {
  return {
    database: parseDatabase(source, production),
    queue: {
      url: urlValue(source, "REDIS_URL", networkFallback(production, "redis://localhost:6379"), [
        "redis:",
        "rediss:",
      ]),
      localPort: integerValue(source, "REDIS_PORT", 6379, 1, 65_535),
    },
  };
}

export function parseStorage(source: EnvironmentSource): AppConfig["storage"] {
  return {
    duckdbTempDir: required(source, "DUCKDB_TEMP_DIR", ".tmp/duckdb"),
    objectStorageMode: oneOf(source, "OBJECT_STORAGE_MODE", ["local"] as const, "local"),
    objectStoragePath: required(source, "OBJECT_STORAGE_PATH", ".data/objects"),
    reportStoragePath: required(source, "REPORT_STORAGE_PATH", ".data/reports"),
  };
}

function normalizedTenantValue(source: EnvironmentSource, key: string, fallback = ""): string {
  const raw = source[key] === undefined ? fallback : source[key];
  const normalized = raw?.normalize("NFC").trim() ?? "";
  if (!normalized && fallback) {
    throw new EnvironmentValidationError(`${key} must not be blank when supplied.`);
  }
  return normalized;
}

function parseAdmin(source: EnvironmentSource): {
  email: string;
  name: string;
  passwordFile: string;
} {
  const email = normalizedTenantValue(source, "DEFAULT_ADMIN_EMAIL").toLowerCase();
  const name = normalizedTenantValue(source, "DEFAULT_ADMIN_NAME");
  const passwordFile = normalizedTenantValue(source, "DEFAULT_ADMIN_PASSWORD_FILE");
  if ((email || passwordFile) && !name) {
    throw new EnvironmentValidationError(
      "DEFAULT_ADMIN_NAME is required when fresh admin configuration is supplied.",
    );
  }
  if ((name || passwordFile) && !email) {
    throw new EnvironmentValidationError(
      "DEFAULT_ADMIN_EMAIL is required when fresh admin configuration is supplied.",
    );
  }
  if ((email || name) && !passwordFile) {
    throw new EnvironmentValidationError(
      "DEFAULT_ADMIN_PASSWORD_FILE is required when fresh admin metadata is supplied.",
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+$/u.test(email)) {
    throw new EnvironmentValidationError("DEFAULT_ADMIN_EMAIL must be a valid canonical email.");
  }
  return { email, name, passwordFile };
}

function parseApiKeyPrefix(source: EnvironmentSource): string {
  const prefix = normalizedTenantValue(source, "API_KEY_PREFIX", "ccpo");
  if (!/^[a-z][a-z0-9]{0,15}$/u.test(prefix)) {
    throw new EnvironmentValidationError(
      "API_KEY_PREFIX must be a safe lowercase issuance prefix.",
    );
  }
  return prefix;
}

export function parseTenant(
  source: EnvironmentSource,
  nodeEnv: NodeEnvironment,
): AppConfig["tenant"] {
  const admin = parseAdmin(source);
  return {
    ...parseRegistrationConfig(source, nodeEnv),
    defaultTenantName: normalizedTenantValue(source, "DEFAULT_TENANT_NAME", "Default"),
    defaultAdminEmail: admin.email,
    defaultAdminName: admin.name,
    defaultAdminPasswordFile: admin.passwordFile,
    apiKeyPrefix: parseApiKeyPrefix(source),
  };
}
