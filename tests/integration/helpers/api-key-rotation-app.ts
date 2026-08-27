import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";

import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import {
  createApiKeyCredential,
  type ApiKeyCredential,
} from "../../../core/tenant/api-key-credential.js";
import { createApiKeyRotationRepository } from "../../../core/tenant/api-key-rotation-repository.js";
import { createApiKeyRotationService } from "../../../core/tenant/api-key-rotation-service.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import {
  createLocalProtectedUsersLimiter,
  type ProtectedUsersLimiter,
} from "../../../core/tenant/protected-users-limiter.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createEphemeralTestToken } from "../../helpers/auth-test-tokens.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

export interface RotationHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  privateKey: KeyObject;
  tenantA: string;
  tenantB: string;
  actors: Map<string, string>;
  targetId: string;
  revokedId: string;
  crossTenantId: string;
  analystApiKey: string;
  generated: { count: number };
  logs: string[];
}

interface RotationFixtureRows {
  tenantA: string;
  tenantB: string;
  actors: Map<string, string>;
  targetId: string;
  revokedId: string;
  crossTenantId: string;
  analystApiKey: string;
}

interface RotationTestRuntime {
  app: ReturnType<typeof buildApp>;
  privateKey: KeyObject;
  generated: { count: number };
  logs: string[];
}

export async function createRotationHarness(
  prefix: string,
  limiter: ProtectedUsersLimiter = createLocalProtectedUsersLimiter(),
): Promise<RotationHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const fixtures = await insertFixtureRows(pool);
  const runtime = buildRotationRuntime(pool, limiter);
  return { database, pool, ...fixtures, ...runtime };
}

async function insertFixtureRows(pool: Pool): Promise<RotationFixtureRows> {
  const tenantA = await insertTenant(pool, "Rotation tenant A");
  const tenantB = await insertTenant(pool, "Rotation tenant B");
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
  const active = createApiKeyCredential("ccpo");
  const revoked = createApiKeyCredential("ccpo");
  const foreign = createApiKeyCredential("ccpo");
  const targetId = await insertKey(pool, tenantA, active.keyHash, "origin note", false);
  const revokedId = await insertKey(pool, tenantA, revoked.keyHash, "revoked note", true);
  const crossTenantId = await insertKey(pool, tenantB, foreign.keyHash, "foreign note", false);
  return {
    tenantA,
    tenantB,
    actors,
    targetId,
    revokedId,
    crossTenantId,
    analystApiKey: active.plaintext,
  };
}

function buildRotationRuntime(pool: Pool, limiter: ProtectedUsersLimiter): RotationTestRuntime {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const generated = { count: 0 };
  const credentialFactory = (): ApiKeyCredential => {
    generated.count += 1;
    return createApiKeyCredential("ccpo");
  };
  const logs: string[] = [];
  const app = buildApp({
    logger: captureLogger(logs),
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool),
      jwtPublicKey: keys.publicKey,
      jwtPolicy: jwtPolicy(),
    },
    apiKeyRotation: {
      limiter,
      service: createApiKeyRotationService(
        createApiKeyRotationRepository(pool),
        "ccpo",
        credentialFactory,
      ),
    },
  });
  return { app, privateKey: keys.privateKey, generated, logs };
}

export async function closeRotationHarness(harness?: RotationHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
}

export function rotationAuthorization(
  harness: RotationHarness,
  actorKey = "tenant_admin",
  role: UserRole = "tenant_admin",
  tenantId = harness.tenantA,
): Record<string, string> {
  return { authorization: `Bearer ${rotationToken(harness, actorKey, role, tenantId)}` };
}

export function rotationToken(
  harness: RotationHarness,
  actorKey = "tenant_admin",
  role: UserRole = "tenant_admin",
  tenantId = harness.tenantA,
): string {
  const now = Math.floor(Date.now() / 1000);
  return createEphemeralTestToken({
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
  revoked: boolean,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, key_hash, note, revoked_at)
     VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN transaction_timestamp() ELSE NULL END)
     RETURNING id`,
    [tenantId, keyHash, note, revoked],
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
