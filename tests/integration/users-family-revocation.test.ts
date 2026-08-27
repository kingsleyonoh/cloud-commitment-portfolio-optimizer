import { afterEach, expect, it } from "vitest";

import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: UsersHarness | undefined;

async function updatedAt(current: UsersHarness, id: string): Promise<string> {
  const result = await current.pool.query<{ value: string }>(
    `SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value
     FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0]!.value;
}

async function family(current: UsersHarness, id: string): Promise<string> {
  const result = await current.pool.query<{ id: string }>(
    `INSERT INTO auth_refresh_families (tenant_id, user_id, absolute_expires_at)
     VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
    [current.tenantA, id],
  );
  return result.rows[0]!.id;
}

async function patch(current: UsersHarness, id: string, changes: object) {
  return current.app.inject({
    method: "PATCH",
    url: `/api/users/${id}`,
    headers: { "content-type": "application/json", ...usersAuthorization(current) },
    payload: { expected_updated_at: await updatedAt(current, id), ...changes },
  });
}

async function reason(current: UsersHarness, familyId: string): Promise<string | null> {
  const result = await current.pool.query<{ value: string | null }>(
    "SELECT revocation_reason AS value FROM auth_refresh_families WHERE id = $1",
    [familyId],
  );
  return result.rows[0]!.value;
}

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeUsersHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("revokes all active families in the same transaction on an actual role change", async () => {
  harness = await createUsersHarness("ccpo_users_role_revoke");
  const target = harness.actors.get("finops_analyst")!;
  const first = await family(harness, target);
  const second = await family(harness, target);
  const response = await patch(harness, target, { role: "read_only_auditor" });

  expect(response.statusCode).toBe(200);
  expect(await reason(harness, first)).toBe("role_changed");
  expect(await reason(harness, second)).toBe("role_changed");
});

it("revokes active families on deactivation and reactivation never revives them", async () => {
  harness = await createUsersHarness("ccpo_users_inactive_revoke");
  const target = harness.actors.get("finance_approver")!;
  const id = await family(harness, target);
  const deactivated = await patch(harness, target, { is_active: false });
  const reactivated = await patch(harness, target, { is_active: true });

  expect([deactivated.statusCode, reactivated.statusCode]).toEqual([200, 200]);
  expect(await reason(harness, id)).toBe("user_inactive");
});

it("does not revoke a family when supplied role and activity are unchanged", async () => {
  harness = await createUsersHarness("ccpo_users_no_revoke");
  const target = harness.actors.get("read_only_auditor")!;
  const id = await family(harness, target);
  const response = await patch(harness, target, {
    role: "read_only_auditor",
    is_active: true,
  });

  expect(response.statusCode).toBe(200);
  expect(await reason(harness, id)).toBeNull();
});

it("serializes a family-mutex refresh race before committing role revocation", async () => {
  harness = await createUsersHarness("ccpo_users_refresh_patch_race");
  const target = harness.actors.get("finops_analyst")!;
  const familyId = await family(harness, target);
  const mutex = await harness.pool.connect();
  await mutex.query("BEGIN");
  await mutex.query("SELECT id FROM auth_refresh_families WHERE id = $1 FOR UPDATE", [familyId]);
  let settled = false;
  const pending = patch(harness, target, { role: "finance_approver" }).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(settled).toBe(false);
  await mutex.query("COMMIT");
  mutex.release();
  const response = await pending;
  expect(response.statusCode).toBe(200);
  expect(await reason(harness, familyId)).toBe("role_changed");
});
