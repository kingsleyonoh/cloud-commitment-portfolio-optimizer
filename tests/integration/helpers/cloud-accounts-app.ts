import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";

import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createApiKeyCredential } from "../../../core/tenant/api-key-credential.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import { createCloudAccountsRepository } from "../../../core/tenant/cloud-accounts-repository.js";
import { createCloudAccountsService } from "../../../core/tenant/cloud-accounts-service.js";
import {
  createLocalProtectedUsersLimiter,
  type ProtectedUsersLimiter,
} from "../../../core/tenant/protected-users-limiter.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createEphemeralTestToken } from "../../helpers/auth-test-tokens.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

export interface CloudAccountsHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  privateKey: KeyObject;
  tenantA: string;
  tenantB: string;
  actors: Map<string, string>;
  analystApiKey: string;
  logs: string[];
}

export async function createCloudAccountsHarness(
  prefix: string,
  limiter: ProtectedUsersLimiter = createLocalProtectedUsersLimiter(),
): Promise<CloudAccountsHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const tenantA = await insertTenant(pool, "Cloud accounts tenant A");
  const tenantB = await insertTenant(pool, "Cloud accounts tenant B");
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
    "INSERT INTO api_keys (tenant_id, key_hash, note) VALUES ($1, $2, 'cloud-account-tests')",
    [tenantA, credential.keyHash],
  );
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
    cloudAccounts: {
      limiter,
      service: createCloudAccountsService(createCloudAccountsRepository(pool), logger),
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
    analystApiKey: credential.plaintext,
    logs,
  };
}

export async function closeCloudAccountsHarness(harness?: CloudAccountsHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
}

export function cloudAccountsAuthorization(
  harness: CloudAccountsHarness,
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

export async function insertCloudAccount(
  pool: Pool,
  input: {
    tenantId: string;
    provider: "aws" | "azure" | "gcp";
    externalRef: string;
    displayName: string;
    currency?: string;
    tags?: Record<string, unknown>;
    isActive?: boolean;
    createdAt?: string;
  },
): Promise<{ id: string; updatedAt: string }> {
  if (input.createdAt === undefined) {
    const result = await pool.query<{ id: string; updated_at: string }>(
      `INSERT INTO cloud_accounts
         (tenant_id, provider, external_ref, display_name, currency, tags, is_active)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
      [
        input.tenantId,
        input.provider,
        input.externalRef,
        input.displayName,
        input.currency ?? "USD",
        JSON.stringify(input.tags ?? {}),
        input.isActive ?? true,
      ],
    );
    return { id: result.rows[0]!.id, updatedAt: result.rows[0]!.updated_at };
  }
  const result = await pool.query<{ id: string; updated_at: string }>(
    `INSERT INTO cloud_accounts
       (tenant_id, provider, external_ref, display_name, currency, tags, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)
     RETURNING id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
    [
      input.tenantId,
      input.provider,
      input.externalRef,
      input.displayName,
      input.currency ?? "USD",
      JSON.stringify(input.tags ?? {}),
      input.isActive ?? true,
      input.createdAt,
    ],
  );
  return { id: result.rows[0]!.id, updatedAt: result.rows[0]!.updated_at };
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
