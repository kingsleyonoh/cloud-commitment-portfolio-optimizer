import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createArgonExecutor } from "../../../core/tenant/argon-executor.js";
import { createApiKeyCredential } from "../../../core/tenant/api-key-credential.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import {
  createLocalProtectedUsersLimiter,
  type ProtectedUsersLimiter,
} from "../../../core/tenant/protected-users-limiter.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createUserPasswordRepository } from "../../../core/tenant/user-password-repository.js";
import {
  createUserPasswordService,
  type PasswordHasher,
} from "../../../core/tenant/user-password-service.js";
import { createUsersRepository } from "../../../core/tenant/users-repository.js";
import { createUsersService } from "../../../core/tenant/users-service.js";
import { createEphemeralTestToken } from "../../helpers/auth-test-tokens.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

export interface UsersHarness {
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

export async function createUsersHarness(
  prefix: string,
  passwordHasher?: PasswordHasher,
  limiter: ProtectedUsersLimiter = createLocalProtectedUsersLimiter(),
): Promise<UsersHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const tenantA = await insertTenant(pool, "Tenant A users marker");
  const tenantB = await insertTenant(pool, "Tenant B users marker");
  const actors = new Map<string, string>();
  for (const role of [
    "tenant_admin",
    "finops_analyst",
    "finance_approver",
    "read_only_auditor",
  ] as const) {
    actors.set(role, await insertUser(pool, tenantA, `${role}@tenant-a.example.invalid`, role));
  }
  actors.set(
    "tenant-b-admin",
    await insertUser(pool, tenantB, "admin@tenant-b.example.invalid", "tenant_admin"),
  );
  actors.set(
    "tenant-b-marker",
    await insertUser(pool, tenantB, "hidden-marker@tenant-b.example.invalid", "finops_analyst"),
  );
  const credential = createApiKeyCredential("ccpo");
  await pool.query("INSERT INTO api_keys (tenant_id, key_hash) VALUES ($1, $2)", [
    tenantA,
    credential.keyHash,
  ]);
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
    users: {
      limiter,
      service: createUsersService(createUsersRepository(pool), logger),
      passwordService: createUserPasswordService(
        createUserPasswordRepository(pool),
        createArgonExecutor({ concurrency: 2, queueLimit: 32 }),
        passwordHasher,
      ),
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

export async function closeUsersHarness(harness?: UsersHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
}

export function usersToken(
  harness: UsersHarness,
  actorKey: string,
  role: UserRole,
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

export function usersAuthorization(
  harness: UsersHarness,
  actorKey = "tenant_admin",
  role: UserRole = "tenant_admin",
  tenantId = harness.tenantA,
): Record<string, string> {
  return { authorization: `Bearer ${usersToken(harness, actorKey, role, tenantId)}` };
}

export async function insertUser(
  pool: Pool,
  tenantId: string,
  email: string,
  role: UserRole,
  isActive = true,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, email, email.split("@", 1)[0], role, isActive],
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

async function insertTenant(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
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
