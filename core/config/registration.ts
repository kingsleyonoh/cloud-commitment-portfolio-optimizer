import ipaddr from "ipaddr.js";
import {
  EnvironmentValidationError,
  type AppConfig,
  type EnvironmentSource,
  type NodeEnvironment,
} from "./env-schema.js";
import { booleanValue, oneOf, value } from "./env-values.js";

export type RegistrationConfig = Pick<
  AppConfig["tenant"],
  | "selfRegistrationEnabled"
  | "selfRegistrationProductionAck"
  | "registrationLimiterMode"
  | "registrationTrustedProxyCidrs"
  | "registrationEdgeEnforcesLimit"
>;

export function parseRegistrationConfig(
  source: EnvironmentSource,
  nodeEnv: NodeEnvironment,
): RegistrationConfig {
  const config: RegistrationConfig = {
    selfRegistrationEnabled: booleanValue(source, "SELF_REGISTRATION_ENABLED", false),
    selfRegistrationProductionAck: booleanValue(source, "SELF_REGISTRATION_PRODUCTION_ACK", false),
    registrationLimiterMode: oneOf(
      source,
      "REGISTRATION_LIMITER_MODE",
      ["local", "redis", "trusted_edge"] as const,
      "local",
    ),
    registrationTrustedProxyCidrs: proxyCidrs(source),
    registrationEdgeEnforcesLimit: booleanValue(source, "REGISTRATION_EDGE_ENFORCES_LIMIT", false),
  };
  validateTrustedEdge(config);
  validateProduction(config, nodeEnv);
  return config;
}

function proxyCidrs(source: EnvironmentSource): string[] {
  const entries = value(source, "REGISTRATION_TRUSTED_PROXY_CIDRS")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry.includes("%") || (!ipaddr.isValid(entry) && !ipaddr.isValidCIDR(entry))) {
      throw new EnvironmentValidationError(
        "REGISTRATION_TRUSTED_PROXY_CIDRS must contain explicit IP addresses or CIDRs.",
      );
    }
  }
  return entries;
}

function validateTrustedEdge(config: RegistrationConfig): void {
  if (
    config.registrationLimiterMode === "trusted_edge" &&
    (!config.registrationEdgeEnforcesLimit || config.registrationTrustedProxyCidrs.length === 0)
  ) {
    throw new EnvironmentValidationError(
      "Trusted-edge registration limiting requires explicit enforcement and proxy allowlist.",
    );
  }
}

function validateProduction(config: RegistrationConfig, nodeEnv: NodeEnvironment): void {
  if (nodeEnv !== "production" || !config.selfRegistrationEnabled) return;
  if (!config.selfRegistrationProductionAck) {
    throw new EnvironmentValidationError(
      "SELF_REGISTRATION_PRODUCTION_ACK=true is required when registration is enabled in production.",
    );
  }
  if (config.registrationLimiterMode === "local") {
    throw new EnvironmentValidationError(
      "Process-local registration limiting is forbidden in production.",
    );
  }
}
