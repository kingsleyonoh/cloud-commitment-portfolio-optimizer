import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { runMigrations } from "../../core/db/migrations.js";
import type { Logger } from "../../core/shared/logger.js";
import { createApiKeyCredential } from "../../core/tenant/api-key-credential.js";
import { createApiKeyMetadataRepository } from "../../core/tenant/api-key-metadata-repository.js";
import { createApiKeyMetadataService } from "../../core/tenant/api-key-metadata-service.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import { createTenantProfileRepository } from "../../core/tenant/profile-repository.js";
import { createTenantProfileService } from "../../core/tenant/profile-service.js";
import { createLocalProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { createUsersRepository } from "../../core/tenant/users-repository.js";
import { createUsersService } from "../../core/tenant/users-service.js";
import { createEphemeralTestToken } from "../helpers/auth-test-tokens.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

interface SettingsHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  privateKey: KeyObject;
  tenantA: string;
  tenantB: string;
  actors: Map<string, string>;
}

let harness: SettingsHarness;

beforeAll(async () => {
  harness = await createSettingsHarness();
});

afterAll(async () => {
  await harness?.app.close();
  await harness?.pool.end();
  await dropIsolatedDatabase(harness?.database);
});

describe("/settings UI", () => {
  it("renders tenant identity, risk defaults, users, and API-key metadata for tenant admins", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/settings",
      headers: { accept: "text/html", ...authorization("tenant_admin", "tenant_admin") },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>Settings | Cloud Commitment Portfolio Optimizer</title>",
    );
    expect(response.body).toContain("Tenant identity");
    expect(response.body).toContain("Aurora Ω Portfolio");
    expect(response.body).toContain("Aurora Ω Portfolio Legal Holdings Limited");
    expect(response.body).toContain("finance@aurora.example.invalid");
    expect(response.body).toContain("Risk defaults");
    expect(response.body).toContain("CAD");
    expect(response.body).toContain("America/Toronto");
    expect(response.body).toContain("$12,345.67");
    expect(response.body).toContain("Tenant users");
    expect(response.body).toContain("Primary Admin");
    expect(response.body).toContain("tenant_admin");
    expect(response.body).toContain("Suspended Analyst");
    expect(response.body).toContain("inactive");
    expect(response.body).toContain("API-key inventory");
    expect(response.body).toContain("settings-visible-current");
    expect(response.body).toContain("revoked");
    expect(response.body).not.toContain("settings-hidden-foreign");
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toMatch(
      /<script|key_hash|plaintext|password|secret|token|authorization|Bearer|stack|postgres/iu,
    );
  });

  it("requires tenant-admin management authority for the aggregate page", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/settings",
      headers: { accept: "text/html", ...authorization("finops_analyst", "finops_analyst") },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("settings-visible-current");
    expect(response.body).not.toContain(harness.tenantB);
  });

  it("requires authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/settings",
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/key_hash|password|token|stack|postgres/iu);
  });
});

async function createSettingsHarness(): Promise<SettingsHarness> {
  const database = await createIsolatedDatabase("ccpo_settings_ui");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const tenantA = await insertTenant(
    pool,
    "Aurora Ω Portfolio",
    "CAD",
    "America/Toronto",
    "1234567",
  );
  const tenantB = await insertTenant(pool, "Hidden Foreign Tenant", "USD", "UTC", "7");
  const actors = new Map<string, string>();
  actors.set(
    "tenant_admin",
    await insertUser(
      pool,
      tenantA,
      "admin@aurora.example.invalid",
      "Primary Admin",
      "tenant_admin",
    ),
  );
  actors.set(
    "finops_analyst",
    await insertUser(
      pool,
      tenantA,
      "finops@aurora.example.invalid",
      "FinOps Analyst",
      "finops_analyst",
    ),
  );
  await insertUser(
    pool,
    tenantA,
    "suspended@aurora.example.invalid",
    "Suspended Analyst",
    "finops_analyst",
    false,
  );
  await insertUser(
    pool,
    tenantB,
    "foreign@hidden.example.invalid",
    "Hidden Foreign User",
    "tenant_admin",
  );
  const current = createApiKeyCredential("ccpo");
  const revoked = createApiKeyCredential("ccpo");
  const hidden = createApiKeyCredential("ccpo");
  await insertKey(
    pool,
    tenantA,
    current.keyHash,
    "settings-visible-current",
    "2026-02-01T00:00:00.000000Z",
  );
  await insertKey(
    pool,
    tenantA,
    revoked.keyHash,
    "settings-visible-revoked",
    "2026-01-01T00:00:00.000000Z",
    "2026-03-01T00:00:00.000000Z",
  );
  await insertKey(
    pool,
    tenantB,
    hidden.keyHash,
    "settings-hidden-foreign",
    "2026-04-01T00:00:00.000000Z",
  );
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const logger = silentLogger();
  const limiter = createLocalProtectedUsersLimiter();
  const app = buildApp({
    logger,
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
    tenantProfile: { service: createTenantProfileService(createTenantProfileRepository(pool)) },
    users: { limiter, service: createUsersService(createUsersRepository(pool), logger) },
    apiKeys: {
      limiter,
      service: createApiKeyMetadataService(createApiKeyMetadataRepository(pool)),
    },
  });
  return { database, pool, app, privateKey: keys.privateKey, tenantA, tenantB, actors };
}

function authorization(actorKey: string, role: UserRole): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  const token = createEphemeralTestToken({
    privateKey: harness.privateKey,
    payload: {
      iss: "ccpo",
      aud: "ccpo-ui",
      sub: harness.actors.get(actorKey)!,
      tenant_id: harness.tenantA,
      role,
      jti: randomUUID(),
      iat: now,
      exp: now + 300,
    },
  });
  return { authorization: `Bearer ${token}` };
}

async function insertTenant(
  pool: Pool,
  displayName: string,
  currency: string,
  timezone: string,
  riskBudgetCents: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants
       (name, legal_name, full_legal_name, display_name, contact_email, finance_owner_email,
        default_currency, timezone, risk_budget_cents)
     VALUES ($1, $2, $3, $1, $4, $5, $6, $7, $8) RETURNING id`,
    [
      displayName,
      `${displayName} Legal`,
      `${displayName} Legal Holdings Limited`,
      "finance@aurora.example.invalid",
      "owner@aurora.example.invalid",
      currency,
      timezone,
      riskBudgetCents,
    ],
  );
  return result.rows[0]!.id;
}

async function insertUser(
  pool: Pool,
  tenantId: string,
  email: string,
  name: string,
  role: UserRole,
  isActive = true,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, email, name, role, isActive],
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
