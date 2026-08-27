import { createPublicKey } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import { createLocalProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import { createUsersRepository } from "../../core/tenant/users-repository.js";
import { createUsersService } from "../../core/tenant/users-service.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";

let harness: UsersHarness;

beforeAll(async () => {
  harness = await createUsersHarness("ccpo_users_patch");
});

afterAll(async () => {
  await closeUsersHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

async function userFor(tenantId: string, id: string) {
  const result = await harness.pool.query<{
    email: string;
    name: string;
    role: string;
    is_active: boolean;
    updated_at: string;
  }>(
    `SELECT email, name, role, is_active,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
     FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0]!;
}

describe("PATCH /api/users/{id}", () => {
  it("updates supplied fields under exact optimistic concurrency", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { "content-type": "application/json", ...usersAuthorization(harness) },
      payload: {
        email: "patch-target@example.invalid",
        name: "Patch Target",
        role: "finops_analyst",
      },
    });
    const target = created.json();
    const updated = await harness.app.inject({
      method: "PATCH",
      url: `/api/users/${target.id}`,
      headers: { "content-type": "application/json", ...usersAuthorization(harness) },
      payload: {
        expected_updated_at: target.updated_at,
        email: " PATCHED@Target.Example.Invalid ",
        name: "Patched Name",
        role: "read_only_auditor",
        is_active: false,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: target.id,
      email: "patched@target.example.invalid",
      name: "Patched Name",
      role: "read_only_auditor",
      is_active: false,
    });
    expect(updated.json().updated_at).not.toBe(target.updated_at);

    const stale = await harness.app.inject({
      method: "PATCH",
      url: `/api/users/${target.id}`,
      headers: { "content-type": "application/json", ...usersAuthorization(harness) },
      payload: { expected_updated_at: target.updated_at, name: "Stale" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("USER_VERSION_CONFLICT");
  });

  it("returns identical tenant-scoped 404 for absent and cross-tenant targets", async () => {
    const targetId = harness.actors.get("tenant-b-marker")!;
    const target = await userFor(harness.tenantB, targetId);
    const responses = await Promise.all([
      patchAsDefault(targetId, target.updated_at, { name: "Cross tenant" }),
      patchAsDefault("99999999-9999-4999-8999-999999999999", target.updated_at, {
        name: "Absent",
      }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("USER_NOT_FOUND");
    }
    expect((await userFor(harness.tenantB, targetId)).name).not.toBe("Cross tenant");
  });

  it("maps normalized-email collisions to the generic 409", async () => {
    const targetId = harness.actors.get("finops_analyst")!;
    const target = await userFor(harness.tenantA, targetId);
    const response = await patchAsDefault(targetId, target.updated_at, {
      email: " TENANT_ADMIN@tenant-a.example.invalid ",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("USER_CONFLICT");
    expect(response.body).not.toMatch(/tenant_admin@|constraint|users_tenant_email_key/iu);
  });

  it("rejects the last admin and retains stale/deactivated actor behavior", async () => {
    const adminId = harness.actors.get("tenant-b-admin")!;
    const initial = await userFor(harness.tenantB, adminId);
    const auth = usersAuthorization(harness, "tenant-b-admin", "tenant_admin", harness.tenantB);
    const denied = await patchWith(auth, adminId, {
      expected_updated_at: initial.updated_at,
      role: "finops_analyst",
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe("LAST_TENANT_ADMIN_REQUIRED");

    const replacement = await createAdmin(auth, "replacement@tenant-b.example.invalid");
    harness.actors.set("tenant-b-replacement", replacement.id);
    const changed = await patchWith(auth, adminId, {
      expected_updated_at: initial.updated_at,
      role: "finops_analyst",
    });
    expect(changed.statusCode).toBe(200);
    const stale = await harness.app.inject({ method: "GET", url: "/api/users", headers: auth });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error.code).toBe("AUTH_INVALID");

    const replacementAuth = usersAuthorization(
      harness,
      "tenant-b-replacement",
      "tenant_admin",
      harness.tenantB,
    );
    const another = await createAdmin(replacementAuth, "another@tenant-b.example.invalid");
    harness.actors.set("tenant-b-another", another.id);
    const replacementRow = await userFor(harness.tenantB, replacement.id);
    const deactivated = await patchWith(replacementAuth, replacement.id, {
      expected_updated_at: replacementRow.updated_at,
      is_active: false,
    });
    expect(deactivated.statusCode).toBe(200);
    const inactive = await harness.app.inject({
      method: "GET",
      url: "/api/users",
      headers: replacementAuth,
    });
    expect(inactive.statusCode).toBe(403);
    expect(inactive.json().error.code).toBe("USER_INACTIVE");
  });

  it("maps a users repository dependency loss to sanitized 503", async () => {
    const failedPool = new Pool({ connectionString: harness.database.url });
    await failedPool.end();
    const logger = safeLogger();
    const app = buildApp({
      logger,
      databaseProbe: async () => ({ ready: true }),
      databaseTimeoutMs: 100,
      authentication: {
        repository: createAuthRepository(harness.pool),
        jwtPublicKey: createPublicKey(harness.privateKey),
        jwtPolicy: {
          issuer: "ccpo",
          audience: "ccpo-ui",
          maxLifetimeSeconds: 900,
          clockToleranceSeconds: 30,
        },
      },
      users: {
        limiter: createLocalProtectedUsersLimiter(),
        service: createUsersService(createUsersRepository(failedPool), logger),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: usersAuthorization(harness),
    });
    await app.close();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "USERS_UNAVAILABLE",
        message: "User management is temporarily unavailable.",
        details: [],
      },
    });
    expect(response.body).not.toMatch(/(?:database|postgres|connection|stack)/iu);
  });
});

function patchAsDefault(id: string, expected: string, changes: Record<string, unknown>) {
  return patchWith(usersAuthorization(harness), id, { expected_updated_at: expected, ...changes });
}

function patchWith(headers: Record<string, string>, id: string, payload: object) {
  return harness.app.inject({
    method: "PATCH",
    url: `/api/users/${id}`,
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}

async function createAdmin(headers: Record<string, string>, email: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/users",
    headers: { "content-type": "application/json", ...headers },
    payload: { email, name: "Replacement Admin", role: "tenant_admin" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

function safeLogger() {
  const logger = {
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
