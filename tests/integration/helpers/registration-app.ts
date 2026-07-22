import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createLocalRegistrationLimiter } from "../../../core/tenant/registration-limiter.js";
import { createTenantRegistrationService } from "../../../core/tenant/registration-service.js";
import type { IsolatedDatabase } from "./postgres-database.js";
import { createIsolatedDatabase } from "./postgres-database.js";

export interface RegistrationHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: FastifyInstance;
  logs: string[];
}

export function runtimeIdempotencyKey(): string {
  return randomBytes(24).toString("base64url");
}

export async function createRegistrationHarness(
  prefix: string,
  options: { enabled?: boolean; trustedProxyCidrs?: string[]; clock?: () => number } = {},
): Promise<RegistrationHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 10 });
  const logs: string[] = [];
  const logger = captureLogger(logs);
  const enabled = options.enabled ?? true;
  const app = buildApp({
    logger,
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    ...(options.trustedProxyCidrs
      ? { registrationTrustedProxyCidrs: options.trustedProxyCidrs }
      : {}),
    ...(enabled
      ? {
          tenantRegistration: {
            limiter: createLocalRegistrationLimiter(options.clock ? { clock: options.clock } : {}),
            service: createTenantRegistrationService(pool, "ccpo"),
          },
        }
      : {}),
  });
  return { database, pool, app, logs };
}

export async function closeRegistrationHarness(harness?: RegistrationHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
}

function captureLogger(records: string[]): Logger {
  const emit = async (event: string, attributes?: Readonly<Record<string, unknown>>) => {
    records.push(JSON.stringify({ event, ...attributes }));
  };
  const logger: Logger = {
    debug: emit,
    info: emit,
    warn: emit,
    error: emit,
    child: () => logger,
    flush: async () => undefined,
    close: async () => undefined,
  };
  return logger;
}
