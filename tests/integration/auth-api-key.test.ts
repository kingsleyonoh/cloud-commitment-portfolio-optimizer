import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { runMigrations } from "../../core/db/migrations.js";
import { createApiKeyCredential } from "../../core/tenant/api-key-credential.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import type { RequestContext } from "../../core/tenant/request-context.js";
import type { Logger } from "../../core/shared/logger.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
const observed: RequestContext[] = [];
let database: IsolatedDatabase | undefined;
let pool: Pool;
let app: ReturnType<typeof buildApp>;
let active: { plaintext: string; tenantId: string; keyId: string };
let other: { plaintext: string; tenantId: string };
let revokedPlaintext: string, inactivePlaintext: string;

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

async function tenant(name: string, isActive = true): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name, is_active)
     VALUES ($1, $1, $1, $1, $2) RETURNING id`,
    [name, isActive],
  );
  return result.rows[0]!.id;
}

async function apiKey(
  tenantId: string,
  revoked = false,
): Promise<{ plaintext: string; keyId: string }> {
  const credential = createApiKeyCredential("ccpo");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, key_hash, revoked_at)
     VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END) RETURNING id`,
    [tenantId, credential.keyHash, revoked],
  );
  return { plaintext: credential.plaintext, keyId: result.rows[0]!.id };
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_auth_api_key");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  pool = new Pool({ connectionString: database.url });
  const activeTenant = await tenant("Auth tenant Alpha");
  const otherTenant = await tenant("Auth tenant Béta");
  const inactiveTenant = await tenant("Inactive auth tenant", false);
  const activeCredential = await apiKey(activeTenant);
  const otherCredential = await apiKey(otherTenant);
  revokedPlaintext = (await apiKey(activeTenant, true)).plaintext;
  inactivePlaintext = (await apiKey(inactiveTenant)).plaintext;
  active = { ...activeCredential, tenantId: activeTenant };
  other = { plaintext: otherCredential.plaintext, tenantId: otherTenant };
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  app = buildApp({
    logger: silentLogger(),
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool),
      jwtPublicKey: publicKey,
      jwtPolicy: {
        issuer: "ccpo",
        audience: "ccpo-ui",
        maxLifetimeSeconds: 900,
        clockToleranceSeconds: 30,
      },
    },
    protectedRoutes(instance) {
      instance.get("/api/context-null-probe", async (request) => ({
        contextIsNull: request.authContext === null,
      }));
      instance.get("/api/auth-probe", { preHandler: instance.authenticate }, async (request) => {
        observed.push(request.authContext!);
        return { authenticated: true, actorType: request.authContext!.actorType };
      });
      instance.get(
        "/api/action-probe",
        {
          preHandler: [instance.authenticate, instance.requireAction("tenant_profile.read")],
        },
        async () => ({ actionGuardPassed: true }),
      );
    },
  });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await dropIsolatedDatabase(database);
});

describe("API-key request context with real PostgreSQL and Fastify", () => {
  it("initializes each encapsulated request context to null", async () => {
    const response = await app.inject({ method: "GET", url: "/api/context-null-probe" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ contextIsNull: true });
  });

  it("resolves an active unrevoked key as fixed no-user finops analyst", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth-probe",
      headers: { "x-api-key": active.plaintext },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: true, actorType: "api_key" });
    expect(observed.at(-1)).toEqual({
      tenantId: active.tenantId,
      actorType: "api_key",
      actorUserId: null,
      apiKeyId: active.keyId,
      role: "finops_analyst",
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain(active.plaintext);
  });

  it.each([
    ["malformed", () => "not-a-key"],
    ["revoked", () => revokedPlaintext],
    ["unknown", () => createApiKeyCredential("ccpo").plaintext],
  ])("returns one generic 401 for %s keys", async (_label, value) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth-probe",
      headers: { "x-api-key": value() },
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

  it("returns 403 only after proving the key belongs to an inactive tenant", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth-probe",
      headers: { "x-api-key": inactivePlaintext },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TENANT_INACTIVE");
  });

  it("allows an explicitly enumerated API-key action through requireAction", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/action-probe",
      headers: { "x-api-key": active.plaintext },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ actionGuardPassed: true });
  });

  it("rejects credential conflict before either credential can win", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth-probe",
      headers: {
        "x-api-key": active.plaintext,
        authorization: ["Bearer", "malformed.token.value"].join(" "),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_CREDENTIAL_CONFLICT");
  });

  it("resolves two similar-looking keys only to their own tenant", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth-probe",
      headers: { "x-api-key": other.plaintext },
    });

    expect(response.statusCode).toBe(200);
    expect(observed.at(-1)?.tenantId).toBe(other.tenantId);
    expect(observed.at(-1)?.tenantId).not.toBe(active.tenantId);
  });

  it("maps a real closed PostgreSQL dependency to a sanitized 503", async () => {
    const failedPool = new Pool({ connectionString: database!.url });
    await failedPool.end();
    const failedApp = buildApp({
      logger: silentLogger(),
      databaseProbe: async () => ({ ready: false }),
      databaseTimeoutMs: 100,
      authentication: {
        repository: createAuthRepository(failedPool),
        jwtPublicKey: null,
        jwtPolicy: {
          issuer: "ccpo",
          audience: "ccpo-ui",
          maxLifetimeSeconds: 900,
          clockToleranceSeconds: 30,
        },
      },
      protectedRoutes(instance) {
        instance.get("/api/auth-probe", { preHandler: instance.authenticate }, async () => ({}));
      },
    });
    const response = await failedApp.inject({
      method: "GET",
      url: "/api/auth-probe",
      headers: { "x-api-key": active.plaintext },
    });
    await failedApp.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "AUTH_DEPENDENCY_UNAVAILABLE",
        message: "Authentication is temporarily unavailable.",
        details: [],
      },
    });
    expect(response.body).not.toContain(active.plaintext);
  });
});
