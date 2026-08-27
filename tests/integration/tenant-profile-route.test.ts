import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import { createTenantProfileRepository } from "../../core/tenant/profile-repository.js";
import { createTenantProfileService } from "../../core/tenant/profile-service.js";
import type { Logger } from "../../core/shared/logger.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  createTenantProfileHarness,
  jwtPolicy,
  token,
  type TenantProfileHarness,
} from "./helpers/tenant-profile-app.js";

let harness: TenantProfileHarness;

beforeAll(async () => {
  harness = await createTenantProfileHarness();
});

afterAll(async () => {
  await harness?.app.close();
  await harness?.pool.end();
  await dropIsolatedDatabase(harness?.database);
});

function authorization(userKey: string, role?: Parameters<typeof token>[3]) {
  return { authorization: `Bearer ${token(harness, userKey, harness.tenantA, role)}` };
}

describe("GET /tenants/me", () => {
  it.each([
    ["tenant_admin", "tenant_admin"],
    ["finops_analyst", "finops_analyst"],
  ] as const)("allows the %s JWT matrix cell", async (userKey, role) => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: authorization(userKey, role),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.json()).toMatchObject({
      id: harness.tenantA,
      name: "Aurora Ω Tenant",
      address: { locality: "Montréal", country_code: "CA" },
      registration: { CA: "AURORA-Ω-001", EU: "EU-長-002" },
      risk_budget_cents: "9223372036854775807",
      is_active: true,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("allows the fixed analyst API-key overlay without exposing the credential", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: { "x-api-key": harness.analystApiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(harness.tenantA);
    expect(response.body).not.toContain(harness.analystApiKey);
  });

  it.each(["finance_approver", "read_only_auditor"] as const)(
    "denies the current %s JWT matrix cell",
    async (role) => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/tenants/me",
        headers: authorization(role, role),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("FORBIDDEN");
    },
  );

  it("returns structured JSON 401 with no authentication", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/tenants/me" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().error.code).toBe("AUTH_REQUIRED");
  });

  it("ignores forged tenant headers and query parameters", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/tenants/me?tenant_id=${harness.tenantB}`,
      headers: {
        ...authorization("finops_analyst", "finops_analyst"),
        "x-tenant-id": harness.tenantB,
        "x-forwarded-tenant-id": harness.tenantB,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(harness.tenantA);
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toContain("Borealis Ж");
  });

  it("returns only the canonical closed metadata projection with no user/key leakage", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: authorization("finops_analyst", "finops_analyst"),
    });
    const profile = response.json();

    expect(Object.keys(profile)).toEqual([
      "id",
      "name",
      "legal_name",
      "full_legal_name",
      "display_name",
      "address",
      "registration",
      "contact_email",
      "contact_phone",
      "support_url",
      "finance_owner_email",
      "wordmark",
      "default_currency",
      "timezone",
      "risk_budget_cents",
      "is_active",
      "created_at",
      "updated_at",
    ]);
    expect(profile.risk_budget_cents).toBe("9223372036854775807");
    for (const marker of harness.forbiddenLiterals) expect(response.body).not.toContain(marker);
    expect(response.body).not.toMatch(/(?:key_hash|apiKey|users|api_keys)/u);
  });

  it("preserves optional nulls, Unicode, empty structured objects, and long fields", async () => {
    const userId = await insertTenantBUser();
    harness.users.set("tenant-b-analyst", userId);
    const response = await harness.app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: {
        authorization: `Bearer ${token(harness, "tenant-b-analyst", harness.tenantB)}`,
      },
    });
    const profile = response.json();

    expect(response.statusCode).toBe(200);
    expect(profile.name).toContain("Borealis Ж");
    expect(profile.name.length).toBeGreaterThan(180);
    expect(profile.address).toEqual({});
    expect(profile.registration).toEqual({});
    expect(profile).toMatchObject({
      contact_email: null,
      contact_phone: null,
      support_url: null,
      finance_owner_email: null,
      wordmark: null,
      risk_budget_cents: "7",
    });
  });

  it("returns canonical inactive-tenant 403 after database-confirmed authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: {
        authorization: `Bearer ${token(harness, "inactive-tenant-user", harness.inactiveTenant)}`,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TENANT_INACTIVE");
  });

  it("maps a real profile database failure to a sanitized 503", async () => {
    const failedPool = new Pool({ connectionString: harness.database.url });
    await failedPool.end();
    const app = buildApp({
      logger: silentLogger(),
      databaseProbe: async () => ({ ready: true }),
      databaseTimeoutMs: 100,
      authentication: {
        repository: createAuthRepository(harness.pool),
        jwtPublicKey: null,
        jwtPolicy: jwtPolicy(),
      },
      tenantProfile: {
        service: createTenantProfileService(createTenantProfileRepository(failedPool)),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: { "x-api-key": harness.analystApiKey },
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "TENANT_PROFILE_UNAVAILABLE",
        message: "The tenant profile is temporarily unavailable.",
        details: [],
      },
    });
    expect(response.body).not.toContain("database");
  });
});

async function insertTenantBUser(): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, 'tenant-b-profile@example.invalid', 'Tenant B profile actor', 'finops_analyst')
     RETURNING id`,
    [harness.tenantB],
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
