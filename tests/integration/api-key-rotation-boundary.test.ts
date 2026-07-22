import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { AppError } from "../../core/shared/errors.js";
import { createLocalProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import {
  closeRotationHarness,
  createRotationHarness,
  rotationAuthorization,
  rotationToken,
  type RotationHarness,
} from "./helpers/api-key-rotation-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: RotationHarness | undefined;

afterEach(async () => {
  const database = harness?.database;
  await closeRotationHarness(harness);
  await dropIsolatedDatabase(database);
  harness = undefined;
});

async function fresh(prefix: string): Promise<RotationHarness> {
  harness = await createRotationHarness(prefix);
  return harness;
}

async function post(
  current: RotationHarness,
  payload: object | string,
  headers: Record<string, string> = rotationAuthorization(current),
) {
  return current.app.inject({
    method: "POST",
    url: "/api/api-keys/rotate",
    headers,
    payload,
  });
}

it("requires exactly one database-confirmed Tenant Admin JWT", async () => {
  const current = await fresh("ccpo_rotation_auth");
  const body = { api_key_id: current.targetId };
  const responses = await Promise.all([
    post(current, body, {}),
    post(current, body, { "x-api-key": current.analystApiKey }),
    post(current, body, rotationAuthorization(current, "finops_analyst", "finops_analyst")),
    post(current, body, {
      authorization: `Bearer ${rotationToken(current)}`,
      "x-api-key": current.analystApiKey,
    }),
  ]);

  expect(responses.map((response) => response.statusCode)).toEqual([401, 403, 403, 401]);
  expect(responses[3]!.json()).toMatchObject({ error: { code: "AUTH_CREDENTIAL_CONFLICT" } });
  expect(current.generated.count).toBe(0);
});

it("returns 403 for database-inactive users and tenants before generation", async () => {
  const current = await fresh("ccpo_rotation_inactive");
  await current.pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [
    current.actors.get("tenant_admin"),
  ]);
  const inactiveUser = await post(current, { api_key_id: current.targetId });
  await current.pool.query(`UPDATE users SET is_active = true WHERE id = $1`, [
    current.actors.get("tenant_admin"),
  ]);
  await current.pool.query(`UPDATE tenants SET is_active = false WHERE id = $1`, [current.tenantA]);
  const inactiveTenant = await post(current, { api_key_id: current.targetId });

  expect([inactiveUser.statusCode, inactiveTenant.statusCode]).toEqual([403, 403]);
  expect(inactiveUser.json()).toMatchObject({ error: { code: "USER_INACTIVE" } });
  expect(inactiveTenant.json()).toMatchObject({ error: { code: "TENANT_INACTIVE" } });
  expect(current.generated.count).toBe(0);
});

it("rejects closed-body violations and 16 KiB overflow before generation or limiting", async () => {
  const current = await fresh("ccpo_rotation_body");
  const invalid = await post(current, {
    api_key_id: current.targetId,
    tenant_id: current.tenantA,
  });
  const explicitNull = await post(current, { api_key_id: current.targetId, note: null });
  const padded = await post(current, { api_key_id: current.targetId, note: " padded" });
  const overflow = await current.app.inject({
    method: "POST",
    url: "/api/api-keys/rotate",
    headers: { ...rotationAuthorization(current), "content-type": "application/json" },
    payload: JSON.stringify({ api_key_id: current.targetId, note: "x".repeat(17_000) }),
  });

  expect([
    invalid.statusCode,
    explicitNull.statusCode,
    padded.statusCode,
    overflow.statusCode,
  ]).toEqual([400, 400, 400, 413]);
  expect(overflow.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  expect(current.generated.count).toBe(0);
});

it("admits five schema-valid requests and rejects the sixth before generation and DB", async () => {
  harness = await createRotationHarness(
    "ccpo_rotation_limit",
    createLocalProtectedUsersLimiter({ clock: () => 1_000_000 }),
  );
  const current = harness;
  for (let count = 0; count < 5; count += 1) {
    const response = await post(current, { api_key_id: randomUUID() });
    expect(response.statusCode).toBe(404);
  }
  const before = await current.pool.query(`SELECT count(*)::int AS count FROM api_keys`);
  const sixth = await post(current, { api_key_id: randomUUID() });
  const after = await current.pool.query(`SELECT count(*)::int AS count FROM api_keys`);

  expect(sixth.statusCode).toBe(429);
  expect(sixth.headers["retry-after"]).toBe("60");
  expect(sixth.json()).toEqual({
    error: { code: "RATE_LIMITED", message: "Too many API-key rotation requests.", details: [] },
  });
  expect(current.generated.count).toBe(5);
  expect(after.rows[0]).toEqual(before.rows[0]);
});

it("fails closed on limiter dependency loss before credential generation", async () => {
  const unavailable = new AppError({
    code: "PROTECTED_RATE_LIMIT_DEPENDENCY_UNAVAILABLE",
    message: "Protected request limiting is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
  harness = await createRotationHarness("ccpo_rotation_limiter_down", {
    mode: "redis",
    async admit() {
      throw unavailable;
    },
  });

  const response = await post(harness, { api_key_id: harness.targetId });

  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({
    error: {
      code: "PROTECTED_RATE_LIMIT_DEPENDENCY_UNAVAILABLE",
      message: "Protected request limiting is temporarily unavailable.",
      details: [],
    },
  });
  expect(harness.generated.count).toBe(0);
});
