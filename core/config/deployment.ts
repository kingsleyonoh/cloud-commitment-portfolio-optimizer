import { createManagedCache, type ManagedCache } from "../shared/lifecycle.js";

export type DeploymentEnvironment = "development" | "test" | "production";
export type DeploymentSource = Readonly<Record<string, string | undefined>>;

export interface DeploymentConfig {
  deploymentRegion: string;
  databaseRegion: string;
}

export class DeploymentConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeploymentConfigError";
    this.code = code;
  }
}

export function parseDeploymentRegions(
  source: DeploymentSource,
  nodeEnv: DeploymentEnvironment,
): DeploymentConfig {
  const production = nodeEnv === "production";
  const deploymentRegion = regionValue(source.DEPLOYMENT_REGION, production);
  const databaseRegion = regionValue(source.DATABASE_REGION, production);
  if (production && deploymentRegion !== databaseRegion) {
    throw new DeploymentConfigError(
      "DEPLOYMENT_REGION_MISMATCH",
      "DEPLOYMENT_REGION must match DATABASE_REGION in production.",
    );
  }
  return { deploymentRegion, databaseRegion };
}

export function createDeploymentConfigCache<T extends object>(
  factory: () => T | Promise<T>,
): ManagedCache<Readonly<T>> {
  return createManagedCache(async () => deepFreeze(await factory()));
}

function regionValue(input: string | undefined, required: boolean): string {
  const region = input?.trim() || (required ? "" : "local");
  if (!region) {
    throw new DeploymentConfigError(
      "DEPLOYMENT_REGION_REQUIRED",
      "DEPLOYMENT_REGION and DATABASE_REGION are required in production.",
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/iu.test(region)) {
    throw new DeploymentConfigError(
      "DEPLOYMENT_REGION_INVALID",
      "Deployment region identifiers must use letters, numbers, and hyphens.",
    );
  }
  return region;
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested as object);
    }
  }
  return Object.freeze(value);
}
