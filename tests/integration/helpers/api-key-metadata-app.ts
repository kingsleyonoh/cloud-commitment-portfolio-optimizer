import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";

import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createApiKeyCredential } from "../../../core/tenant/api-key-credential.js";
import { createApiKeyMetadataRepository } from "../../../core/tenant/api-key-metadata-repository.js";
import { createApiKeyMetadataService } from "../../../core/tenant/api-key-metadata-service.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import { createLocalProtectedUsersLimiter } from "../../../core/tenant/protected-users-limiter.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createEphemeralTestToken } from "../../helpers/auth-test-tokens.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

export interface ApiKeyMetadataHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  privateKey: KeyObject;
  tenantA: string;
  tenantB: string;
  actors: Map<string, string>;
  analystApiKey: string;
  metadataIds: string[];
}

export async function createApiKeyMetadataHarness(prefix: string): Promise<ApiKeyMetadataHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const tenantA = await insertTenant(pool, "API key metadata tenant A");
  const tenantB = await insertTenant(pool, "API key metadata tenant B");
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
  const first = createApiKeyCredential("ccpo");
  const second = createApiKeyCredential("ccpo");
  const hidden = createApiKeyCredential("ccpo");
  const metadataIds = [
    await insertKey(pool, tenantA, first.keyHash, "visible-current", "2026-01-02T00:00:00.123456Z"),
    await insertKey(
      pool,
      tenantA,
      second.keyHash,
      "visible-revoked",
      "2026-01-01T00:00:00.654321Z",
      "2026-01-03T00:00:00.000001Z",
    ),
  ];
  await insertKey(
    pool,
    tenantB,
    hidden.keyHash,
    "cross-tenant-hidden",
    "2026-01-04T00:00:00.111111Z",
  );
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const logger = safeLogger();
  const app = buildApp({
    logger,
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool),
      jwtPublicKey: keys.publicKey,
      jwtPolicy: jwtPolicy(),
    },
    apiKeys: {
      limiter: createLocalProtectedUsersLimiter(),
      service: createApiKeyMetadataService(createApiKeyMetadataRepository(pool)),
    },
  });
  return {
    database,
    pool,
    app,
    privateKey: keys.privateKey,
    tenantA,
    tenantB,
    actors,
    analystApiKey: first.plaintext,
    metadataIds,
  };
}

export async function closeApiKeyMetadataHarness(harness?: ApiKeyMetadataHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
}

export function apiKeyMetadataAuthorization(
  harness: ApiKeyMetadataHarness,
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
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
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

async function insertKey(
  pool: Pool,
  tenantId: string,
  keyHash: string,
  note: string,
  createdAt: string,
  revokedAt?: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, key_hash, note, created_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, keyHash, note, createdAt, revokedAt ?? null],
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

function safeLogger(): Logger {
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
