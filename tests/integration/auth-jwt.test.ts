import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { runMigrations } from "../../core/db/migrations.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import type { Logger } from "../../core/shared/logger.js";
import { createEphemeralTestToken } from "../helpers/auth-test-tokens.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
const roles: UserRole[] = [
  "tenant_admin",
  "finops_analyst",
  "finance_approver",
  "read_only_auditor",
];
let database: IsolatedDatabase | undefined;
let pool: Pool;
let app: ReturnType<typeof buildApp>;
let privateKey: KeyObject;
let tenantId: string;
let otherTenantId: string;
let inactiveTenantId: string;
const users = new Map<UserRole, string>();
let inactiveUserId: string;
let inactiveTenantUserId: string;

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

async function insertTenant(name: string, active = true): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name, is_active)
     VALUES ($1, $1, $1, $1, $2) RETURNING id`,
    [name, active],
  );
  return result.rows[0]!.id;
}

async function insertUser(
  ownerTenantId: string,
  role: UserRole,
  suffix: string,
  active = true,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ownerTenantId, `${suffix}@example.invalid`, `User ${suffix}`, role, active],
  );
  return result.rows[0]!.id;
}

function token(
  userId: string,
  claimedTenantId: string,
  role: UserRole,
  signingKey: KeyObject = privateKey,
): string {
  const now = Math.floor(Date.now() / 1000);
  return createEphemeralTestToken({
    privateKey: signingKey,
    payload: {
      iss: "ccpo",
      aud: "ccpo-ui",
      sub: userId,
      tenant_id: claimedTenantId,
      role,
      jti: randomUUID(),
      iat: now,
      exp: now + 300,
    },
  });
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_auth_jwt");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  pool = new Pool({ connectionString: database.url });
  tenantId = await insertTenant("JWT tenant Alpha");
  otherTenantId = await insertTenant("JWT tenant Béta");
  inactiveTenantId = await insertTenant("JWT tenant inactive", false);
  for (const role of roles) users.set(role, await insertUser(tenantId, role, role));
  await insertUser(otherTenantId, "finops_analyst", "other-tenant");
  inactiveUserId = await insertUser(tenantId, "finops_analyst", "inactive-user", false);
  inactiveTenantUserId = await insertUser(
    inactiveTenantId,
    "finops_analyst",
    "inactive-tenant-user",
  );
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = keys.privateKey;
  app = buildApp({
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
    protectedRoutes(instance) {
      instance.get("/api/jwt-probe", { preHandler: instance.authenticate }, async (request) => ({
        authenticated: true,
        actorType: request.authContext!.actorType,
        role: request.authContext!.role,
        tenantId: request.authContext!.tenantId,
      }));
    },
  });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await dropIsolatedDatabase(database);
});

describe("JWT request context with real PostgreSQL and Fastify", () => {
  it.each(roles)("resolves active %s from current database authority", async (role) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/jwt-probe",
      headers: { authorization: `Bearer ${token(users.get(role)!, tenantId, role)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      actorType: "user",
      role,
      tenantId,
    });
  });

  it.each([
    ["stale database role", () => token(users.get("finops_analyst")!, tenantId, "tenant_admin")],
    ["tenant mismatch", () => token(users.get("finops_analyst")!, otherTenantId, "finops_analyst")],
    ["unknown user", () => token(randomUUID(), tenantId, "finops_analyst")],
    [
      "bad signature",
      () =>
        token(
          users.get("finops_analyst")!,
          tenantId,
          "finops_analyst",
          generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
        ),
    ],
  ])("returns one generic 401 for %s", async (_label, makeToken) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/jwt-probe",
      headers: { authorization: `Bearer ${makeToken()}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "AUTH_INVALID",
        message: "Authentication credentials are invalid.",
        details: [],
      },
    });
  });

  it("returns USER_INACTIVE only after signature and database identity proof", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/jwt-probe",
      headers: {
        authorization: `Bearer ${token(inactiveUserId, tenantId, "finops_analyst")}`,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("USER_INACTIVE");
  });

  it("returns TENANT_INACTIVE only after signature and joined identity proof", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/jwt-probe",
      headers: {
        authorization: `Bearer ${token(inactiveTenantUserId, inactiveTenantId, "finops_analyst")}`,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TENANT_INACTIVE");
  });
});
