import { afterEach, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";

let harness: UsersHarness | undefined;

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeUsersHarness(current);
  await dropIsolatedDatabase(current?.database);
});

async function exactUpdatedAt(tenantId: string, id: string): Promise<string> {
  const result = await harness!.pool.query<{ value: string }>(
    `SELECT to_char(updated_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value
     FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0]!.value;
}

function post(email: string) {
  return harness!.app.inject({
    method: "POST" as const,
    url: "/api/users",
    headers: { "content-type": "application/json", ...usersAuthorization(harness!) },
    payload: { email, name: "Race User", role: "finops_analyst" },
  });
}

it("serializes same-tenant normalized-email creates to one row", async () => {
  harness = await createUsersHarness("ccpo_users_email_race");
  const responses = await Promise.all([
    post(" race.user@Example.Invalid "),
    post("RACE.USER@example.invalid"),
  ]);

  expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
  expect(responses.find(({ statusCode }) => statusCode === 409)!.json().error.code).toBe(
    "USER_CONFLICT",
  );
  const count = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE tenant_id = $1 AND email = $2",
    [harness.tenantA, "race.user@example.invalid"],
  );
  expect(count.rows[0]!.count).toBe(1);
});

it("allows only one patch for the same exact updated_at", async () => {
  harness = await createUsersHarness("ccpo_users_version_race");
  const targetId = harness.actors.get("finops_analyst")!;
  const expected = await exactUpdatedAt(harness.tenantA, targetId);
  const patch = (name: string) =>
    harness!.app.inject({
      method: "PATCH" as const,
      url: `/api/users/${targetId}`,
      headers: { "content-type": "application/json", ...usersAuthorization(harness!) },
      payload: { expected_updated_at: expected, name },
    });
  const responses = await Promise.all([patch("Version Race A"), patch("Version Race B")]);

  expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
  expect(responses.find(({ statusCode }) => statusCode === 409)!.json().error.code).toBe(
    "USER_VERSION_CONFLICT",
  );
});

it("serializes two-admin transitions and never leaves zero active admins", async () => {
  harness = await createUsersHarness("ccpo_users_admin_race");
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/users",
    headers: { "content-type": "application/json", ...usersAuthorization(harness) },
    payload: {
      email: "second-admin@example.invalid",
      name: "Second Admin",
      role: "tenant_admin",
    },
  });
  expect(created.statusCode).toBe(201);
  const secondId = created.json().id as string;
  harness.actors.set("second-admin", secondId);
  const firstId = harness.actors.get("tenant_admin")!;
  const [firstVersion, secondVersion] = await Promise.all([
    exactUpdatedAt(harness.tenantA, firstId),
    exactUpdatedAt(harness.tenantA, secondId),
  ]);
  const responses = await Promise.all([
    harness.app.inject({
      method: "PATCH",
      url: `/api/users/${firstId}`,
      headers: { "content-type": "application/json", ...usersAuthorization(harness) },
      payload: { expected_updated_at: firstVersion, role: "finops_analyst" },
    }),
    harness.app.inject({
      method: "PATCH",
      url: `/api/users/${secondId}`,
      headers: {
        "content-type": "application/json",
        ...usersAuthorization(harness, "second-admin"),
      },
      payload: { expected_updated_at: secondVersion, is_active: false },
    }),
  ]);

  expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
  expect(responses.find(({ statusCode }) => statusCode === 409)!.json().error.code).toBe(
    "LAST_TENANT_ADMIN_REQUIRED",
  );
  const active = await harness.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM users
     WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true`,
    [harness.tenantA],
  );
  expect(active.rows[0]!.count).toBe(1);
});
