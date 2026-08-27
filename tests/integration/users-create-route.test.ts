import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";

let harness: UsersHarness;

beforeAll(async () => {
  harness = await createUsersHarness("ccpo_users_create");
});

afterAll(async () => {
  await closeUsersHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

function createPayload(email: string) {
  return { email, name: "  A\u0308da User  ", role: "finops_analyst" };
}

describe("POST /api/users", () => {
  it("creates only normalized identity/authorization metadata with a 201", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { "content-type": "application/json", ...usersAuthorization(harness) },
      payload: createPayload("  NEW.User@Example.Invalid  "),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      email: "new.user@example.invalid",
      name: "Äda User",
      role: "finops_analyst",
      is_active: true,
    });
    expect(Object.keys(response.json())).toEqual([
      "id",
      "email",
      "name",
      "role",
      "is_active",
      "created_at",
      "updated_at",
    ]);
    expect(response.body).not.toMatch(/(?:tenant_id|password|token|api.?key|hash|audit)/iu);
    const event = harness.logs.find((line) => line.includes("users.mutation.succeeded"));
    expect(event).toBeDefined();
    expect(event).not.toMatch(/new\.user|äda|authorization|token|api.?key/iu);
  });

  it("maps same-tenant canonical email conflict generically but allows another tenant", async () => {
    const before = await tenantUserCount(harness.tenantA);
    const duplicate = await harness.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { "content-type": "application/json", ...usersAuthorization(harness) },
      payload: createPayload(" NEW.USER@example.invalid "),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: {
        code: "USER_CONFLICT",
        message: "A user conflicts with existing metadata.",
        details: [],
      },
    });
    expect(duplicate.body).not.toMatch(/new\.user|constraint|users_tenant_email_key/iu);
    expect(await tenantUserCount(harness.tenantA)).toBe(before);

    const crossTenant = await harness.app.inject({
      method: "POST",
      url: "/api/users",
      headers: {
        "content-type": "application/json",
        ...usersAuthorization(harness, "tenant-b-admin", "tenant_admin", harness.tenantB),
      },
      payload: createPayload("NEW.USER@example.invalid"),
    });
    expect(crossTenant.statusCode).toBe(201);
    expect(crossTenant.json().email).toBe("new.user@example.invalid");
  });

  it("rejects unknown credential and wrong-type fields before mutation", async () => {
    const before = await tenantUserCount(harness.tenantA);
    for (const payload of [
      { ...createPayload("bad-one@example.invalid"), password: "not-accepted" },
      { ...createPayload("bad-two@example.invalid"), role: "owner" },
      { ...createPayload("bad-three@example.invalid"), is_active: "true" },
      { ...createPayload("bad-four@@example.invalid") },
    ]) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/users",
        headers: { "content-type": "application/json", ...usersAuthorization(harness) },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Request is invalid.",
        details: [],
      });
    }
    expect(await tenantUserCount(harness.tenantA)).toBe(before);
  });
});

async function tenantUserCount(tenantId: string): Promise<number> {
  const result = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE tenant_id = $1",
    [tenantId],
  );
  return result.rows[0]!.count;
}
