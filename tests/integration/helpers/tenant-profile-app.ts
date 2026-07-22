import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createApiKeyCredential } from "../../../core/tenant/api-key-credential.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import { createTenantProfileRepository } from "../../../core/tenant/profile-repository.js";
import { createTenantProfileService } from "../../../core/tenant/profile-service.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createEphemeralTestToken } from "../../helpers/auth-test-tokens.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

export interface TenantProfileHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  privateKey: KeyObject;
  tenantA: string;
  tenantB: string;
  inactiveTenant: string;
  users: Map<string, string>;
  analystApiKey: string;
  forbiddenLiterals: readonly string[];
}

export async function createTenantProfileHarness(): Promise<TenantProfileHarness> {
  const database = await createIsolatedDatabase("ccpo_tenant_profile");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url });
  const tenantA = await insertTenantA(pool);
  const tenantB = await insertTenantB(pool);
  const inactiveTenant = await insertInactiveTenant(pool);
  const users = new Map<string, string>();
  for (const role of [
    "tenant_admin",
    "finops_analyst",
    "finance_approver",
    "read_only_auditor",
  ] as const) {
    users.set(role, await insertUser(pool, tenantA, role, `actor-${role}`));
  }
  users.set(
    "inactive-tenant-user",
    await insertUser(pool, inactiveTenant, "finops_analyst", "inactive-tenant-actor"),
  );
  const forbiddenLiterals = ["person-secret-marker", "internal-key-note-marker"];
  await insertUser(pool, tenantA, "finops_analyst", forbiddenLiterals[0]!);
  const credential = createApiKeyCredential("ccpo");
  await pool.query("INSERT INTO api_keys (tenant_id, key_hash, note) VALUES ($1, $2, $3)", [
    tenantA,
    credential.keyHash,
    forbiddenLiterals[1],
  ]);
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const app = buildApp({
    logger: silentLogger(),
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool),
      jwtPublicKey: keys.publicKey,
      jwtPolicy: jwtPolicy(),
    },
    tenantProfile: {
      service: createTenantProfileService(createTenantProfileRepository(pool)),
    },
  });
  return {
    database,
    pool,
    app,
    privateKey: keys.privateKey,
    tenantA,
    tenantB,
    inactiveTenant,
    users,
    analystApiKey: credential.plaintext,
    forbiddenLiterals,
  };
}

export function token(
  harness: TenantProfileHarness,
  userKey: string,
  tenantId = harness.tenantA,
  role: UserRole = "finops_analyst",
): string {
  const now = Math.floor(Date.now() / 1000);
  return createEphemeralTestToken({
    privateKey: harness.privateKey,
    payload: {
      iss: "ccpo",
      aud: "ccpo-ui",
      sub: harness.users.get(userKey)!,
      tenant_id: tenantId,
      role,
      jti: randomUUID(),
      iat: now,
      exp: now + 300,
    },
  });
}

export function jwtPolicy() {
  return {
    issuer: "ccpo",
    audience: "ccpo-ui",
    maxLifetimeSeconds: 900,
    clockToleranceSeconds: 30,
  } as const;
}

async function insertTenantA(pool: Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants
      (name, legal_name, full_legal_name, display_name, address, registration,
       contact_email, contact_phone, support_url, finance_owner_email, wordmark,
       default_currency, timezone, risk_budget_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      "Aurora Ω Tenant",
      "Aurora Ω Legal",
      "Aurora Ω Legal Holdings Limited",
      "Aurora Ω",
      {
        line1: "1 Étoile Way",
        line2: "Suite 長",
        locality: "Montréal",
        region: "Québec",
        postal_code: "H0H 0H0",
        country_code: "CA",
      },
      { CA: "AURORA-Ω-001", EU: "EU-長-002" },
      "finance@aurora.example.invalid",
      "+1 555 0100",
      "https://aurora.example.invalid/support",
      "owner@aurora.example.invalid",
      "Aurora Ω",
      "CAD",
      "America/Toronto",
      "9223372036854775807",
    ],
  );
  return result.rows[0]!.id;
}

async function insertTenantB(pool: Pool): Promise<string> {
  const longName = `Borealis Ж ${"界".repeat(180)}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants
      (name, legal_name, full_legal_name, display_name, address, registration,
       contact_email, contact_phone, support_url, finance_owner_email, wordmark,
       default_currency, timezone, risk_budget_cents)
     VALUES ($1,$1,$1,$1,$2,$3,NULL,NULL,NULL,NULL,NULL,'EUR','Europe/Helsinki','7') RETURNING id`,
    [longName, {}, {}],
  );
  return result.rows[0]!.id;
}

async function insertInactiveTenant(pool: Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name, is_active)
     VALUES ('Inactive profile tenant','Inactive profile tenant','Inactive profile tenant','Inactive profile tenant',false)
     RETURNING id`,
  );
  return result.rows[0]!.id;
}

async function insertUser(
  pool: Pool,
  tenantId: string,
  role: UserRole,
  marker: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `${marker}@example.invalid`, marker, role],
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
