import { resolve } from "node:path";
import { Pool } from "pg";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../../apps/api/app.js";
import { runSetup } from "../../core/db/setup.js";
import type { Logger } from "../../core/shared/logger.js";
import { createLocalRegistrationLimiter } from "../../core/tenant/registration-limiter.js";
import { createTenantRegistrationService } from "../../core/tenant/registration-service.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";
import { runtimeIdempotencyKey } from "./helpers/registration-app.js";

let database: IsolatedDatabase | undefined;
let pool: Pool | undefined;
let app: ReturnType<typeof buildApp> | undefined;

const logger: Logger = {
  debug: async () => undefined,
  info: async () => undefined,
  warn: async () => undefined,
  error: async () => undefined,
  child: () => logger,
  flush: async () => undefined,
  close: async () => undefined,
};

function setupOptions() {
  return {
    databaseUrl: database!.url,
    migrationsDirectory: resolve("db/migrations"),
    tenant: {
      defaultTenantName: "Setup Tenant",
      defaultAdminEmail: "",
      defaultAdminName: "",
      apiKeyPrefix: "ccpo",
    },
  };
}

afterEach(async () => {
  await app?.close();
  await pool?.end();
  await dropIsolatedDatabase(database);
  app = undefined;
  pool = undefined;
  database = undefined;
});

it("setup rerun ignores a complete extra self-registration while preserving its marker identity", async () => {
  database = await createIsolatedDatabase("ccpo_setup_after_registration");
  const first = await runSetup(setupOptions());
  pool = new Pool({ connectionString: database.url });
  app = buildApp({
    logger,
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    tenantRegistration: {
      limiter: createLocalRegistrationLimiter(),
      service: createTenantRegistrationService(pool, "ccpo"),
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/tenants/register",
    headers: {
      "content-type": "application/json",
      "idempotency-key": runtimeIdempotencyKey(),
    },
    payload: { name: "Additional Tenant" },
  });
  expect(response.statusCode).toBe(201);

  const rerun = await runSetup(setupOptions());
  const counts = await pool.query<{
    tenants: number;
    keys: number;
    markers: number;
    receipts: number;
  }>(`SELECT (SELECT count(*)::int FROM tenants) AS tenants,
    (SELECT count(*)::int FROM api_keys) AS keys,
    (SELECT count(*)::int FROM api_keys WHERE note = 'system:first-run:v1') AS markers,
    (SELECT count(*)::int FROM registration_requests) AS receipts`);

  expect(first.initialization.created).toBe(true);
  expect(rerun.initialization.created).toBe(false);
  expect("apiKey" in rerun.initialization).toBe(false);
  expect(counts.rows[0]).toEqual({ tenants: 2, keys: 2, markers: 1, receipts: 1 });
});
