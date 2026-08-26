import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";

import { Pool } from "pg";

import { buildApp } from "../../../apps/api/app.js";
import { createDashboardRepository } from "../../../core/dashboard/dashboard-repository.js";
import { createDashboardService } from "../../../core/dashboard/dashboard-service.js";
import { runMigrations } from "../../../core/db/migrations.js";
import type { Logger } from "../../../core/shared/logger.js";
import { createArgonExecutor } from "../../../core/tenant/argon-executor.js";
import { createAuthLoginRepository } from "../../../core/tenant/auth-login-repository.js";
import { createAuthLogoutRepository } from "../../../core/tenant/auth-logout-repository.js";
import { createAuthRefreshRepository } from "../../../core/tenant/auth-refresh-repository.js";
import { createAuthRepository } from "../../../core/tenant/auth-repository.js";
import { createSessionCookiePolicy } from "../../../core/tenant/auth-session-cookie.js";
import { createAuthSessionLimiter } from "../../../core/tenant/auth-session-limiter.js";
import { hashPassword } from "../../../core/tenant/password-credential.js";
import { createUserPasswordRepository } from "../../../core/tenant/user-password-repository.js";
import type { UserRole } from "../../../core/tenant/request-context.js";
import { createIsolatedDatabase, type IsolatedDatabase } from "./postgres-database.js";

const SESSION_KEYS = generateKeyPairSync("rsa", { modulusLength: 2048 });
let credentialMaterialPromise:
  Promise<{ password: string; passwordHash: string; dummyPasswordHash: string }> | undefined;

export interface AuthSessionHarness {
  database: IsolatedDatabase;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  tenantId: string;
  otherTenantId: string;
  userId: string;
  adminId: string;
  password: string;
  origin: string;
  logs: Array<{ level: string; event: string }>;
}

export async function createAuthSessionHarness(prefix: string): Promise<AuthSessionHarness> {
  const database = await createIsolatedDatabase(prefix);
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  const pool = new Pool({ connectionString: database.url, max: 20 });
  const tenantId = await insertTenant(pool, `${prefix} primary`);
  const otherTenantId = await insertTenant(pool, `${prefix} secondary`);
  const adminId = await insertUser(pool, tenantId, "tenant_admin", "admin");
  const userId = await insertUser(pool, tenantId, "finops_analyst", "session-user");
  await insertUser(pool, otherTenantId, "finops_analyst", "other-user");
  const argonExecutor = createArgonExecutor({ concurrency: 2, queueLimit: 32 });
  const { password, passwordHash, dummyPasswordHash } = await credentialMaterial();
  await createUserPasswordRepository(pool).setPassword({
    tenantId,
    actorUserId: adminId,
    targetUserId: userId,
    requestId: "fixture-provision",
    passwordHash,
  });
  const limiter = await createAuthSessionLimiter({ mode: "local", redisUrl: "unused" });
  const origin = "http://127.0.0.1:8080";
  const logs: Array<{ level: string; event: string }> = [];
  const app = buildApp({
    logger: captureLogger(logs),
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool),
      jwtPublicKey: SESSION_KEYS.publicKey,
      jwtPrivateKey: SESSION_KEYS.privateKey,
      jwtPolicy: {
        issuer: "ccpo",
        audience: "ccpo-ui",
        maxLifetimeSeconds: 900,
        clockToleranceSeconds: 30,
      },
      cookiePolicy: createSessionCookiePolicy({
        secure: false,
        publicBaseUrl: origin,
        accessLifetimeSeconds: 900,
      }),
      sessions: {
        loginRepository: createAuthLoginRepository(pool),
        refreshRepository: createAuthRefreshRepository(pool),
        logoutRepository: createAuthLogoutRepository(pool),
        limiter,
        argonExecutor,
        dummyPasswordHash,
        trustedProxyCidrs: [],
      },
    },
    protectedRoutes(instance) {
      const boundary = [instance.authenticate, instance.requireAction("tenant_profile.read")];
      instance.get("/api/session-probe", { preHandler: boundary }, async () => ({ ok: true }));
      instance.post("/api/session-probe", { preHandler: boundary }, async () => ({ ok: true }));
    },
    dashboard: {
      service: createDashboardService(createDashboardRepository(pool)),
    },
  });
  return { database, pool, app, tenantId, otherTenantId, userId, adminId, password, origin, logs };
}

export async function closeAuthSessionHarness(harness?: AuthSessionHarness): Promise<void> {
  if (!harness) return;
  await harness.app.close();
  await harness.pool.end();
}

export function generatedPassword(seed: number): string {
  return Array.from({ length: 20 }, (_, index) =>
    String.fromCodePoint(65 + ((seed + index) % 25)),
  ).join("");
}

async function credentialMaterial() {
  credentialMaterialPromise ??= createCredentialMaterial();
  return credentialMaterialPromise;
}

async function createCredentialMaterial() {
  const executor = createArgonExecutor({ concurrency: 2, queueLimit: 32 });
  try {
    const password = generatedPassword(3);
    const passwordHash = await hashPassword(password, executor);
    const dummyPasswordHash = await hashPassword(generatedPassword(9), executor);
    return { password, passwordHash, dummyPasswordHash };
  } finally {
    executor.close();
  }
}

export async function login(harness: AuthSessionHarness, overrides: Record<string, unknown> = {}) {
  return harness.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json; charset=utf-8",
    },
    payload: {
      tenant_id: harness.tenantId,
      email: "session-user@example.invalid",
      password: harness.password,
      ...overrides,
    },
  });
}

export function responseCookies(response: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

export function sessionRequest(
  harness: AuthSessionHarness,
  path: "/api/auth/refresh" | "/api/auth/logout",
  cookies: Record<string, string>,
) {
  return harness.app.inject({
    method: "POST",
    url: path,
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": cookies.ccpo_csrf!,
    },
    cookies,
  });
}

async function insertTenant(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name,legal_name,full_legal_name,display_name)
     VALUES ($1,$1,$1,$1) RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function insertUser(
  pool: Pool,
  tenantId: string,
  role: UserRole,
  localPart: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id,email,name,role)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [tenantId, `${localPart}@example.invalid`, localPart, role],
  );
  return result.rows[0]!.id;
}

function captureLogger(records: Array<{ level: string; event: string }>): Logger {
  const emit = (level: string) => async (event: string) => {
    records.push({ level, event });
  };
  const logger: Logger = {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: () => logger,
    flush: async () => undefined,
    close: async () => undefined,
  };
  return logger;
}
