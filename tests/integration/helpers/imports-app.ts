import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createLocalObjectStore, type ObjectStore } from "../../../core/shared/objectStore.js";
import { createImportsRepository } from "../../../core/imports/imports-repository.js";
import { createImportsService } from "../../../core/imports/imports-service.js";
import { createApiKeyCredential } from "../../../core/tenant/api-key-credential.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import { createLocalProtectedUsersLimiter } from "../../../core/tenant/protected-users-limiter.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createEphemeralTestToken } from "../../helpers/auth-test-tokens.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

export interface ImportsHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  objectStore: ObjectStore;
  objectRoot: string;
  privateKey: KeyObject;
  tenantA: string;
  tenantB: string;
  accountA: string;
  azureAccountA: string;
  gcpAccountA: string;
  accountB: string;
  actors: Map<string, string>;
  analystApiKey: string;
  logs: string[];
}

export async function createImportsHarness(prefix: string): Promise<ImportsHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const tenantA = await insertTenant(pool, "Imports tenant A");
  const tenantB = await insertTenant(pool, "Imports tenant B");
  const accountA = await insertCloudAccount(pool, tenantA, "aws", "imports-a");
  const azureAccountA = await insertCloudAccount(pool, tenantA, "azure", "imports-azure-a");
  const gcpAccountA = await insertCloudAccount(pool, tenantA, "gcp", "imports-gcp-a");
  const accountB = await insertCloudAccount(pool, tenantB, "aws", "imports-b");
  const actors = new Map<string, string>();
  for (const role of [
    "tenant_admin",
    "finops_analyst",
    "finance_approver",
    "read_only_auditor",
  ] as const) {
    actors.set(role, await insertUser(pool, tenantA, role));
  }
  actors.set("tenant-b-admin", await insertUser(pool, tenantB, "tenant_admin"));
  const credential = createApiKeyCredential("ccpo");
  await pool.query(
    "INSERT INTO api_keys (tenant_id, key_hash, note) VALUES ($1, $2, 'imports-tests')",
    [tenantA, credential.keyHash],
  );
  const objectRoot = await mkdtemp(join(tmpdir(), "ccpo-import-objects-"));
  const objectStore = createLocalObjectStore(objectRoot);
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const logs: string[] = [];
  const logger = captureLogger(logs);
  const app = buildApp({
    logger,
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool),
      jwtPublicKey: keys.publicKey,
      jwtPolicy: jwtPolicy(),
    },
    imports: {
      limiter: createLocalProtectedUsersLimiter(),
      service: createImportsService(createImportsRepository(pool), objectStore, logger),
    },
  });
  return {
    database,
    pool,
    app,
    objectStore,
    objectRoot,
    privateKey: keys.privateKey,
    tenantA,
    tenantB,
    accountA,
    azureAccountA,
    gcpAccountA,
    accountB,
    actors,
    analystApiKey: credential.plaintext,
    logs,
  };
}

export async function closeImportsHarness(harness?: ImportsHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
  await rm(harness.objectRoot, { recursive: true, force: true });
}

export function importsAuthorization(
  harness: ImportsHarness,
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

export async function putFixtureObject(
  harness: ImportsHarness,
  key: string,
  fixturePath: string,
): Promise<void> {
  await harness.objectStore.put(key, await readFile(fixturePath));
}

async function insertTenant(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function insertCloudAccount(
  pool: Pool,
  tenantId: string,
  provider: string,
  externalRef: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO cloud_accounts
       (tenant_id, provider, external_ref, display_name, currency)
     VALUES ($1, $2, $3, $4, 'USD') RETURNING id`,
    [tenantId, provider, externalRef, `Import ${externalRef}`],
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

function jwtPolicy() {
  return {
    issuer: "ccpo",
    audience: "ccpo-ui",
    maxLifetimeSeconds: 900,
    clockToleranceSeconds: 30,
  } as const;
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
