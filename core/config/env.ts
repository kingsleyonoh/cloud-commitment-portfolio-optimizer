import { createDeploymentConfigCache, parseDeploymentRegions } from "./deployment.js";
import { parseIntegrations, parseObservability } from "./env-integrations.js";
import {
  parseApprovals,
  parseBacktest,
  parseForecasting,
  parseImports,
  parseOptimizer,
} from "./env-planning.js";
import {
  parseAuth,
  parseConnections,
  parseRuntime,
  parseStorage,
  parseTenant,
} from "./env-runtime.js";
import {
  EnvironmentValidationError,
  type AppConfig,
  type EnvironmentSource,
  type NodeEnvironment,
} from "./env-schema.js";
import { oneOf } from "./env-values.js";
import { parseUsersConfig } from "./users.js";

export {
  DEPLOYMENT_ENV_KEYS,
  ENV_KEYS,
  EnvironmentValidationError,
  type AppConfig,
  type DatabaseConfig,
  type EnvironmentSource,
  type ForecastMethod,
  type LogLevel,
  type NodeEnvironment,
} from "./env-schema.js";

function parseNodeEnvironment(source: EnvironmentSource): NodeEnvironment {
  return oneOf(source, "NODE_ENV", ["development", "test", "production"] as const, "development");
}

export function parseEnvironment(source: EnvironmentSource = process.env): AppConfig {
  const nodeEnv = parseNodeEnvironment(source);
  const runtime = parseRuntime(source, nodeEnv);
  const auth = parseAuth(source, nodeEnv);
  validateCookieOrigin(runtime, auth);
  return {
    runtime,
    deployment: parseDeploymentRegions(source, nodeEnv),
    ...parseConnections(source, nodeEnv === "production"),
    storage: parseStorage(source),
    tenant: parseTenant(source, nodeEnv),
    users: parseUsersConfig(source, nodeEnv),
    auth,
    imports: parseImports(source),
    forecasting: parseForecasting(source),
    optimizer: parseOptimizer(source),
    backtest: parseBacktest(source),
    approvals: parseApprovals(source),
    integrations: parseIntegrations(source),
    observability: parseObservability(source),
  };
}

function validateCookieOrigin(runtime: AppConfig["runtime"], auth: AppConfig["auth"]): void {
  if (auth.cookieSecure) return;
  const hostname = new URL(runtime.publicBaseUrl).hostname;
  if (
    runtime.nodeEnv === "production" ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase())
  ) {
    throw new EnvironmentValidationError(
      "Non-secure auth cookies are allowed only on loopback development or test origins.",
    );
  }
}

const environmentConfigCache = createDeploymentConfigCache(() => parseEnvironment(process.env));

export function getEnvironmentConfig(): Promise<Readonly<AppConfig>> {
  return environmentConfigCache.get();
}

export function closeEnvironmentConfig(): Promise<void> {
  return environmentConfigCache.close();
}
