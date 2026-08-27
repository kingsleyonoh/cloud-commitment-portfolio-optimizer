import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { authError } from "../../core/tenant/auth-errors.js";
import { createLocalProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: UsersHarness | undefined;

function passwordValue(seed = 0): string {
  return Array.from({ length: 18 }, (_, index) =>
    String.fromCodePoint(0x61 + ((seed + index) % 24)),
  ).join("");
}

async function put(
  current: UsersHarness,
  targetId: string,
  payload: object | string,
  headers: Record<string, string> = usersAuthorization(current),
) {
  return current.app.inject({
    method: "PUT",
    url: `/api/users/${targetId}/credentials/password`,
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeUsersHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("requires exactly one database-confirmed Tenant Admin JWT", async () => {
  harness = await createUsersHarness("ccpo_password_auth");
  const target = harness.actors.get("finops_analyst")!;
  const responses = await Promise.all([
    put(harness, target, { password: passwordValue() }, {}),
    put(harness, target, { password: passwordValue() }, { "x-api-key": harness.analystApiKey }),
    put(
      harness,
      target,
      { password: passwordValue() },
      usersAuthorization(harness, "finops_analyst", "finops_analyst"),
    ),
  ]);

  expect(responses.map((response) => response.statusCode)).toEqual([401, 403, 403]);
  expect(responses[0]!.json().error.code).toBe("AUTH_REQUIRED");
  expect(responses.slice(1).map((response) => response.json().error.code)).toEqual([
    "FORBIDDEN",
    "FORBIDDEN",
  ]);
});

it("enforces the closed password-only body and the 2048-byte cap", async () => {
  harness = await createUsersHarness("ccpo_password_validation");
  const target = harness.actors.get("finops_analyst")!;
  const responses = await Promise.all([
    put(harness, target, { password: passwordValue(), role: "tenant_admin" }),
    put(harness, target, { password: passwordValue().slice(0, 14) }),
    put(harness, target, { password: `${passwordValue()}\ud800` }),
    put(harness, target, {}),
    put(harness, "not-a-canonical-uuid", { password: passwordValue() }),
    put(harness, target, JSON.stringify({ password: "x".repeat(2100) })),
  ]);

  expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400, 413]);
  expect(responses[5]!.json().error.code).toBe("PAYLOAD_TOO_LARGE");
});

it("returns the same tenant-scoped 404 for absent and cross-tenant targets", async () => {
  harness = await createUsersHarness("ccpo_password_not_found", async () => "not-persisted");
  const responses = await Promise.all([
    put(harness, randomUUID(), { password: passwordValue() }),
    put(harness, harness.actors.get("tenant-b-marker")!, { password: passwordValue(1) }),
  ]);

  for (const response of responses) {
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "User was not found.", details: [] },
    });
  }
});

it("admits five attempts per tenant, actor, target and rejects the sixth before hashing", async () => {
  let hashes = 0;
  harness = await createUsersHarness(
    "ccpo_password_limit",
    async () => {
      hashes += 1;
      return "not-persisted";
    },
    createLocalProtectedUsersLimiter({ clock: () => 1_000_000 }),
  );
  const target = randomUUID();
  for (let index = 0; index < 5; index += 1) {
    expect((await put(harness, target, { password: passwordValue(index) })).statusCode).toBe(404);
  }
  const sixth = await put(harness, target, { password: passwordValue(6) });

  expect(sixth.statusCode).toBe(429);
  expect(sixth.headers["retry-after"]).toBe("60");
  expect(sixth.json().error.code).toBe("RATE_LIMITED");
  expect(hashes).toBe(5);
});

it("maps Argon queue or worker failure to generic safe 503 before database mutation", async () => {
  harness = await createUsersHarness("ccpo_password_argon_down", async () => {
    throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
  });
  const target = harness.actors.get("finops_analyst")!;
  const response = await put(harness, target, { password: passwordValue() });
  const credentials = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM user_auth_credentials",
  );

  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({
    error: {
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      message: "Authentication is temporarily unavailable.",
      details: [],
    },
  });
  expect(credentials.rows[0]!.count).toBe(0);
});
