import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";
import { afterEach, beforeEach, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { runSetup } from "../../core/db/setup.js";
import type { Logger } from "../../core/shared/logger.js";
import { createApiKeyCredential } from "../../core/tenant/api-key-credential.js";
import { createApiKeyRotationRepository } from "../../core/tenant/api-key-rotation-repository.js";
import { createApiKeyRotationService } from "../../core/tenant/api-key-rotation-service.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import { FirstRunInitializationError } from "../../core/tenant/initialization.js";
import { createLocalProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import { createTenantRegistrationService } from "../../core/tenant/registration-service.js";
import { createEphemeralTestToken } from "../helpers/auth-test-tokens.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

let database: IsolatedDatabase | undefined;
let pool: Pool | undefined;
let app: ReturnType<typeof buildApp> | undefined;
let passwordDirectory: string | undefined;
let adminPasswordFile = "";

const logger: Logger = {
  debug: async () => undefined,
  info: async () => undefined,
  warn: async () => undefined,
  error: async () => undefined,
  child: () => logger,
  flush: async () => undefined,
  close: async () => undefined,
};

function setupOptions() {
  return {
    databaseUrl: database!.url,
    migrationsDirectory: resolve("db/migrations"),
    tenant: {
      defaultTenantName: "Rotation Setup Tenant",
      defaultAdminEmail: "rotation-admin@example.invalid",
      defaultAdminName: "Rotation Admin",
      defaultAdminPasswordFile: adminPasswordFile,
      apiKeyPrefix: "ccpo",
    },
  };
}

beforeEach(async () => {
  passwordDirectory = await mkdtemp(join(tmpdir(), "ccpo-rotation-setup-"));
  adminPasswordFile = join(passwordDirectory, "password");
  const value = Array.from({ length: 18 }, (_, index) =>
    String.fromCodePoint(0x61 + (index % 24)),
  ).join("");
  await writeFile(adminPasswordFile, value, { mode: 0o600 });
});

afterEach(async () => {
  await app?.close();
  await pool?.end();
  await dropIsolatedDatabase(database);
  app = undefined;
  pool = undefined;
  database = undefined;
  if (passwordDirectory) await rm(passwordDirectory, { recursive: true });
  passwordDirectory = undefined;
  adminPasswordFile = "";
});

async function makeApp(tenantId: string, actorUserId: string) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  app = buildApp({
    logger,
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(pool!),
      jwtPublicKey: keys.publicKey,
      jwtPolicy: {
        issuer: "ccpo",
        audience: "ccpo-ui",
        maxLifetimeSeconds: 900,
        clockToleranceSeconds: 30,
      },
    },
    apiKeyRotation: {
      limiter: createLocalProtectedUsersLimiter(),
      service: createApiKeyRotationService(createApiKeyRotationRepository(pool!), "ccpo"),
    },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = createEphemeralTestToken({
    privateKey: keys.privateKey,
    payload: {
      iss: "ccpo",
      aud: "ccpo-ui",
      sub: actorUserId,
      tenant_id: tenantId,
      role: "tenant_admin",
      jti: randomUUID(),
      iat: now,
      exp: now + 300,
    },
  });
  return token;
}

async function rotate(token: string, apiKeyId: string): Promise<string> {
  const response = await app!.inject({
    method: "POST",
    url: "/api/api-keys/rotate",
    headers: { authorization: `Bearer ${token}` },
    payload: { api_key_id: apiKeyId },
  });
  expect(response.statusCode).toBe(200);
  return (response.json().replacement_api_key as { id: string }).id;
}

it("accepts a contiguous multi-hop first-run chain while preserving the marker", async () => {
  database = await createIsolatedDatabase("ccpo_setup_rotation_chain");
  const first = await runSetup(setupOptions());
  pool = new Pool({ connectionString: database.url });
  const token = await makeApp(first.initialization.tenantId, first.initialization.adminUserId!);
  const secondId = await rotate(token, first.initialization.apiKeyId);
  const currentId = await rotate(token, secondId);

  const rerun = await runSetup(setupOptions());
  const marker = await pool.query<{ id: string; note: string; revoked: boolean }>(
    `SELECT id, note, revoked_at IS NOT NULL AS revoked
       FROM api_keys WHERE note = 'system:first-run:v1'`,
  );

  expect(rerun.initialization).toMatchObject({ created: false, apiKeyId: currentId });
  expect("apiKey" in rerun.initialization).toBe(false);
  expect(marker.rows).toEqual([
    { id: first.initialization.apiKeyId, note: "system:first-run:v1", revoked: true },
  ]);
});

it("accepts a multi-hop registration-origin chain without changing its receipt", async () => {
  database = await createIsolatedDatabase("ccpo_setup_registration_rotation");
  const first = await runSetup(setupOptions());
  pool = new Pool({ connectionString: database.url });
  await createTenantRegistrationService(pool, "ccpo").register(`registration-${randomUUID()}`, {
    name: "Registered Rotation Tenant",
  });
  const receipt = await pool.query<{ tenantId: string; apiKeyId: string }>(
    `SELECT tenant_id AS "tenantId", api_key_id AS "apiKeyId"
       FROM registration_requests WHERE status = 'succeeded'`,
  );
  const actor = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, $2, 'Registration Admin', 'tenant_admin') RETURNING id`,
    [receipt.rows[0]!.tenantId, `registration-admin-${randomUUID()}@example.invalid`],
  );
  const token = await makeApp(receipt.rows[0]!.tenantId, actor.rows[0]!.id);
  const secondId = await rotate(token, receipt.rows[0]!.apiKeyId);
  await rotate(token, secondId);

  const rerun = await runSetup(setupOptions());
  const preserved = await pool.query<{ apiKeyId: string }>(
    `SELECT api_key_id AS "apiKeyId" FROM registration_requests`,
  );

  expect(rerun.initialization).toMatchObject({
    created: false,
    apiKeyId: first.initialization.apiKeyId,
  });
  expect(preserved.rows[0]?.apiKeyId).toBe(receipt.rows[0]!.apiKeyId);
});

it("fails closed for unaudited origin revocation and rogue key rows", async () => {
  database = await createIsolatedDatabase("ccpo_setup_rotation_ambiguous");
  const first = await runSetup(setupOptions());
  pool = new Pool({ connectionString: database.url });
  const credential = createApiKeyCredential("ccpo");
  await pool.query(`UPDATE api_keys SET revoked_at = transaction_timestamp() WHERE id = $1`, [
    first.initialization.apiKeyId,
  ]);
  await pool.query(`INSERT INTO api_keys (tenant_id, key_hash) VALUES ($1, $2)`, [
    first.initialization.tenantId,
    credential.keyHash,
  ]);

  await expect(runSetup(setupOptions())).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof FirstRunInitializationError &&
      error.code === "INITIALIZATION_STATE_AMBIGUOUS",
  );
});

it("fails closed for a malformed branch even when one canonical chain remains", async () => {
  database = await createIsolatedDatabase("ccpo_setup_rotation_branch");
  const first = await runSetup(setupOptions());
  pool = new Pool({ connectionString: database.url });
  const token = await makeApp(first.initialization.tenantId, first.initialization.adminUserId!);
  await rotate(token, first.initialization.apiKeyId);
  await pool.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
        old_values, new_values, request_id)
       VALUES ($1,$2,'user','api_key.rotated','api_key',$3,'{}'::jsonb,'{}'::jsonb,$4)`,
    [
      first.initialization.tenantId,
      first.initialization.adminUserId,
      first.initialization.apiKeyId,
      `malformed-${randomUUID()}`,
    ],
  );

  await expect(runSetup(setupOptions())).rejects.toMatchObject({
    code: "INITIALIZATION_STATE_AMBIGUOUS",
  });
});
