import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import { createRecommendationsRepository } from "../../../core/recommendations/recommendations-repository.js";
import { createRecommendationsService } from "../../../core/recommendations/recommendations-service.js";
import { createReportsRepository } from "../../../core/reports/reports-repository.js";
import { createReportsService } from "../../../core/reports/reports-service.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createLocalObjectStore, type ObjectStore } from "../../../core/shared/objectStore.js";
import { createApiKeyCredential } from "../../../core/tenant/api-key-credential.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import { createLocalProtectedUsersLimiter } from "../../../core/tenant/protected-users-limiter.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createEphemeralTestToken } from "../../helpers/auth-test-tokens.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

export interface RecommendationsHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  privateKey: KeyObject;
  objectStore: ObjectStore;
  objectStorePath: string;
  tenantA: string;
  tenantB: string;
  actors: Map<string, string>;
  analystApiKey: string;
}

export async function createRecommendationsHarness(
  prefix: string,
): Promise<RecommendationsHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const tenantA = await insertTenant(pool, "Recommendation tenant A");
  const tenantB = await insertTenant(pool, "Recommendation tenant B");
  const actors = new Map<string, string>();
  for (const role of [
    "tenant_admin",
    "finops_analyst",
    "finance_approver",
    "read_only_auditor",
  ] as const) {
    actors.set(role, await insertUser(pool, tenantA, role));
  }
  const credential = createApiKeyCredential("ccpo");
  await pool.query("INSERT INTO api_keys (tenant_id, key_hash, note) VALUES ($1, $2, $3)", [
    tenantA,
    credential.keyHash,
    "recommendation-tests",
  ]);
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const objectStorePath = await mkdtemp(join(tmpdir(), `${prefix}-objects-`));
  const objectStore = createLocalObjectStore(objectStorePath);
  const recommendationsRepository = createRecommendationsRepository(pool);
  const reportsRepository = createReportsRepository(pool);
  const app = buildApp({
    logger: silentLogger(),
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool),
      jwtPublicKey: keys.publicKey,
      jwtPolicy: {
        issuer: "ccpo",
        audience: "ccpo-ui",
        maxLifetimeSeconds: 900,
        clockToleranceSeconds: 30,
      },
    },
    recommendations: {
      limiter: createLocalProtectedUsersLimiter(),
      service: createRecommendationsService(recommendationsRepository),
    },
    reports: {
      limiter: createLocalProtectedUsersLimiter(),
      service: createReportsService(reportsRepository, objectStore),
    },
  });
  return {
    database,
    pool,
    app,
    privateKey: keys.privateKey,
    objectStore,
    objectStorePath,
    tenantA,
    tenantB,
    actors,
    analystApiKey: credential.plaintext,
  };
}

export async function closeRecommendationsHarness(harness?: RecommendationsHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
  await harness.objectStore.close();
  await rm(resolve(harness.objectStorePath), { recursive: true, force: true });
}

export function recommendationsAuthorization(
  harness: RecommendationsHarness,
  actorKey = "tenant_admin",
  role: UserRole = "tenant_admin",
  tenantId = harness.tenantA,
): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  const token = createEphemeralTestToken({
    privateKey: harness.privateKey,
    payload: {
      iss: "ccpo",
      aud: "ccpo-ui",
      sub: harness.actors.get(actorKey)!,
      tenant_id: tenantId,
      role,
      jti: randomUUID(),
      iat: now,
      exp: now + 300,
    },
  });
  return { authorization: `Bearer ${token}` };
}

async function insertTenant(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants
       (name, legal_name, full_legal_name, display_name, contact_email, finance_owner_email)
     VALUES ($1, $1, $1, $1, 'finance@example.invalid', 'finops@example.invalid')
     RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function insertUser(pool: Pool, tenantId: string, role: UserRole): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `${role}-${randomUUID()}@example.invalid`, role, role],
  );
  return result.rows[0]!.id;
}

function silentLogger(): Logger {
  const logger: Logger = {
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
    child: () => logger,
    flush: async () => undefined,
    close: async () => undefined,
  };
  return logger;
}
