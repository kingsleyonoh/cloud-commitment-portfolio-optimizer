import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { runMigrations } from "../../core/db/migrations.js";
import { createApiKeyCredential } from "../../core/tenant/api-key-credential.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import { AUTH_ACTIONS, type AuthAction } from "../../core/tenant/rbac.js";
import { USER_ROLES, type UserRole } from "../../core/tenant/request-context.js";
import type { Logger } from "../../core/shared/logger.js";
import { createEphemeralTestToken } from "../helpers/auth-test-tokens.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const P1_ANALYST = new Set<AuthAction>([
  "tenant_profile.read",
  "cloud_accounts.read",
  "cloud_accounts.create_update",
  "imports.read",
  "imports.write",
  "price_tables.read",
  "forecast_models.read",
  "forecast_models.write",
  "forecast_runs.read",
  "forecast_runs.run",
  "optimizer_policies.read",
  "optimizer_runs.read",
  "optimizer_runs.run",
  "recommendations.read",
  "recommendations.request_approval",
  "reports.read",
  "backtests.read_run",
]);
const P1_ADMIN = new Set<AuthAction>([
  ...P1_ANALYST,
  "cloud_accounts.deactivate",
  "users.read_manage",
  "api_keys.read_manage",
  "api_keys.read_rotate",
  "price_tables.create_activate",
  "optimizer_policies.write",
  "recommendations.approve_reject",
  "approvals.read",
  "tenant_settings.write",
]);
const API_KEY_ALLOWED = new Set<AuthAction>(
  [...P1_ANALYST].filter((action) => action !== "optimizer_policies.read"),
);
const expectedByRole: Record<UserRole, ReadonlySet<AuthAction>> = {
  tenant_admin: P1_ADMIN,
  finops_analyst: P1_ANALYST,
  finance_approver: new Set<AuthAction>([
    "recommendations.read",
    "recommendations.approve_reject",
    "approvals.read",
    "backtests.read_run",
  ]),
  read_only_auditor: new Set(["backtests.read_run"]),
};

let database: IsolatedDatabase | undefined;
let pool: Pool;
let app: ReturnType<typeof buildApp>;
let apiKey = "";
const tokens = new Map<UserRole, string>();

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

async function seedActors(privateKey: KeyObject): Promise<void> {
  const tenant = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    ["RBAC guard tenant"],
  );
  const tenantId = tenant.rows[0]!.id;
  const now = Math.floor(Date.now() / 1000);
  for (const role of USER_ROLES) {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, `${role}@example.invalid`, role, role],
    );
    tokens.set(
      role,
      createEphemeralTestToken({
        privateKey,
        payload: {
          iss: "ccpo",
          aud: "ccpo-ui",
          sub: user.rows[0]!.id,
          tenant_id: tenantId,
          role,
          jti: randomUUID(),
          iat: now,
          exp: now + 300,
        },
      }),
    );
  }
  const credential = createApiKeyCredential("ccpo");
  await pool.query("INSERT INTO api_keys (tenant_id, key_hash) VALUES ($1, $2)", [
    tenantId,
    credential.keyHash,
  ]);
  apiKey = credential.plaintext;
}

function probeUrl(action: AuthAction): string {
  return `/api/rbac-probe/${AUTH_ACTIONS.indexOf(action)}`;
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_rbac_guard");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  pool = new Pool({ connectionString: database.url });
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await seedActors(keys.privateKey);
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
      for (const [index, action] of AUTH_ACTIONS.entries()) {
        instance.get(
          `/api/rbac-probe/${index}`,
          { preHandler: [instance.authenticate, instance.requireAction(action)] },
          async () => ({ reached: action }),
        );
      }
    },
  });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await dropIsolatedDatabase(database);
});

it("returns stable 401 before authorization when authentication is missing", async () => {
  const response = await app.inject({ method: "GET", url: probeUrl("tenant_profile.read") });
  expect(response.statusCode).toBe(401);
  expect(response.json().error.code).toBe("AUTH_REQUIRED");
});

it.each(USER_ROLES)("enforces every current cell for %s JWT", async (role) => {
  for (const action of AUTH_ACTIONS) {
    const response = await app.inject({
      method: "GET",
      url: probeUrl(action),
      headers: { authorization: `Bearer ${tokens.get(role)!}` },
    });
    const allowed = expectedByRole[role].has(action);
    expect(response.statusCode, action).toBe(allowed ? 200 : 403);
    expect(response.json(), action).toEqual(
      allowed
        ? { reached: action }
        : {
            error: {
              code: "FORBIDDEN",
              message: "The requested action is not permitted.",
              details: [],
            },
          },
    );
  }
});

it("enforces every API-key overlay cell without analyst-role inheritance", async () => {
  for (const action of AUTH_ACTIONS) {
    const response = await app.inject({
      method: "GET",
      url: probeUrl(action),
      headers: { "x-api-key": apiKey },
    });
    const allowed = API_KEY_ALLOWED.has(action);
    expect(response.statusCode, action).toBe(allowed ? 200 : 403);
    expect(response.json().error?.code, action).toBe(allowed ? undefined : "FORBIDDEN");
  }
});
