import { closeEnvironmentConfig } from "../../core/config/env.js";
import { closeDbPool } from "../../core/shared/db.js";
import { closeDuckdbAnalytics } from "../../core/shared/duckdbAnalytics.js";
import { closeJobQueue } from "../../core/shared/jobQueue.js";
import { closeLogger } from "../../core/shared/logger.js";
import { closeObjectStore } from "../../core/shared/objectStore.js";
import { closeRegistrationLimiter } from "../../core/tenant/registration-limiter.js";
import { closeProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";

export type ResourceName =
  | "database"
  | "registrationLimiter"
  | "usersLimiter"
  | "jobQueue"
  | "objectStore"
  | "duckdbAnalytics"
  | "environment"
  | "logger";

export type ResourceClosers = Readonly<Record<ResourceName, () => Promise<void>>>;
export interface CloseableApplication {
  close(): Promise<unknown>;
}

const closeOrder: readonly ResourceName[] = [
  "usersLimiter",
  "registrationLimiter",
  "database",
  "jobQueue",
  "objectStore",
  "duckdbAnalytics",
  "environment",
  "logger",
];

const defaultClosers: ResourceClosers = {
  database: closeDbPool,
  registrationLimiter: closeRegistrationLimiter,
  usersLimiter: closeProtectedUsersLimiter,
  jobQueue: closeJobQueue,
  objectStore: closeObjectStore,
  duckdbAnalytics: closeDuckdbAnalytics,
  environment: closeEnvironmentConfig,
  logger: closeLogger,
};

export function createRuntimeCloser(
  app: CloseableApplication | undefined,
  initialized: ReadonlySet<ResourceName>,
  closers: ResourceClosers = defaultClosers,
): () => Promise<void> {
  let operation: Promise<void> | undefined;
  return () => {
    operation ??= closeRuntime(app, initialized, closers);
    return operation;
  };
}

async function closeRuntime(
  app: CloseableApplication | undefined,
  initialized: ReadonlySet<ResourceName>,
  closers: ResourceClosers,
): Promise<void> {
  const failures: unknown[] = [];
  if (app) await attempt(() => app.close(), failures);
  for (const name of closeOrder) {
    if (initialized.has(name)) await attempt(closers[name], failures);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Application shutdown failed.");
  }
}

async function attempt(operation: () => Promise<unknown>, failures: unknown[]): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}
