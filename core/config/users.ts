import ipaddr from "ipaddr.js";

import {
  EnvironmentValidationError,
  type AppConfig,
  type EnvironmentSource,
  type NodeEnvironment,
} from "./env-schema.js";
import { booleanValue, oneOf, value } from "./env-values.js";

export function parseUsersConfig(
  source: EnvironmentSource,
  nodeEnv: NodeEnvironment,
): AppConfig["users"] {
  const config: AppConfig["users"] = {
    limiterMode: oneOf(
      source,
      "USERS_LIMITER_MODE",
      ["local", "redis", "trusted_edge"] as const,
      nodeEnv === "production" ? "redis" : "local",
    ),
    trustedEdgeAck: booleanValue(source, "USERS_TRUSTED_EDGE_ACK", false),
    trustedProxyCidrs: proxyCidrs(source),
  };
  if (
    config.limiterMode === "trusted_edge" &&
    (!config.trustedEdgeAck || config.trustedProxyCidrs.length === 0)
  ) {
    throw new EnvironmentValidationError(
      "Trusted-edge users limiting requires explicit acknowledgement and proxy allowlist.",
    );
  }
  if (nodeEnv === "production" && config.limiterMode === "local") {
    throw new EnvironmentValidationError(
      "Process-local protected users limiting is forbidden in production.",
    );
  }
  return config;
}

function proxyCidrs(source: EnvironmentSource): string[] {
  const entries = value(source, "USERS_TRUSTED_PROXY_CIDRS")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry.includes("%") || (!ipaddr.isValid(entry) && !ipaddr.isValidCIDR(entry))) {
      throw new EnvironmentValidationError(
        "USERS_TRUSTED_PROXY_CIDRS must contain explicit IP addresses or CIDRs.",
      );
    }
  }
  return entries;
}
