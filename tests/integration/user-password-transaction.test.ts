import { afterEach, expect, it } from "vitest";

import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: UsersHarness | undefined;

function passwordValue(seed = 0): string {
  return Array.from({ length: 19 }, (_, index) =>
    String.fromCodePoint(0x41 + ((seed + index) % 25)),
  ).join("");
}

async function put(current: UsersHarness, targetId: string, seed = 0) {
  return current.app.inject({
    method: "PUT",
    url: `/api/users/${targetId}/credentials/password`,
    headers: { "content-type": "application/json", ...usersAuthorization(current) },
    payload: { password: passwordValue(seed) },
  });
}

async function insertFamily(current: UsersHarness, targetId: string): Promise<string> {
  const result = await current.pool.query<{ id: string }>(
    `INSERT INTO auth_refresh_families (tenant_id, user_id, absolute_expires_at)
     VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
    [current.tenantA, targetId],
  );
  return result.rows[0]!.id;
}

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeUsersHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("provisions then resets one credential with family revocation and one safe audit per commit", async () => {
  harness = await createUsersHarness("ccpo_password_transaction");
  const target = harness.actors.get("finops_analyst")!;
  await insertFamily(harness, target);
  const before = await harness.pool.query(
    "SELECT email, name, role, is_active, created_at, updated_at FROM users WHERE id = $1",
    [target],
  );

  const provision = await put(harness, target);
  await insertFamily(harness, target);
  const reset = await put(harness, target, 1);
  const after = await harness.pool.query(
    "SELECT email, name, role, is_active, created_at, updated_at FROM users WHERE id = $1",
    [target],
  );
  const state = await harness.pool.query<{
    credentials: number;
    phcPolicy: boolean;
    revokedFamilies: number;
    auditCount: number;
    auditsSafe: boolean;
  }>(
    `SELECT
      (SELECT count(*)::int FROM user_auth_credentials WHERE tenant_id = $1 AND user_id = $2)
        AS credentials,
      (SELECT password_hash LIKE '$argon2id$v=19$m=65536,t=3,p=1$%'
        AND octet_length(password_hash) <= 512
       FROM user_auth_credentials WHERE tenant_id = $1 AND user_id = $2) AS "phcPolicy",
      (SELECT count(*)::int FROM auth_refresh_families
       WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NOT NULL
         AND revocation_reason = 'password_reset') AS "revokedFamilies",
      (SELECT count(*)::int FROM audit_log
       WHERE tenant_id = $1 AND entity_id = $2) AS "auditCount",
      (SELECT bool_and(actor_type = 'user' AND actor_user_id = $3
        AND action IN ('user.password.provisioned', 'user.password.reset')
        AND entity_type = 'user' AND old_values IS NULL
        AND new_values = jsonb_build_object(
          'result', 'succeeded',
          'sessions_revoked', (new_values->>'sessions_revoked')::int))
       FROM audit_log WHERE tenant_id = $1 AND entity_id = $2) AS "auditsSafe"`,
    [harness.tenantA, target, harness.actors.get("tenant_admin")],
  );

  expect([provision.statusCode, reset.statusCode]).toEqual([204, 204]);
  expect(provision.body).toBe("");
  expect(reset.body).toBe("");
  expect(after.rows[0]).toEqual(before.rows[0]);
  expect(state.rows[0]).toEqual({
    credentials: 1,
    phcPolicy: true,
    revokedFamilies: 2,
    auditCount: 2,
    auditsSafe: true,
  });
});

it("rolls credential, family revocation, and audit back together on audit failure", async () => {
  harness = await createUsersHarness("ccpo_password_rollback");
  const target = harness.actors.get("finops_analyst")!;
  await insertFamily(harness, target);
  await harness.pool.query(`CREATE FUNCTION fail_password_audit() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action LIKE 'user.password.%' THEN RAISE EXCEPTION 'injected'; END IF;
      RETURN NEW;
    END $$`);
  await harness.pool.query(`CREATE TRIGGER fail_password_audit_trigger
    BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_password_audit()`);

  const response = await put(harness, target);
  const state = await harness.pool.query<{
    credentials: number;
    activeFamilies: number;
    audits: number;
  }>(
    `SELECT (SELECT count(*)::int FROM user_auth_credentials) AS credentials,
      (SELECT count(*)::int FROM auth_refresh_families WHERE revoked_at IS NULL) AS "activeFamilies",
      (SELECT count(*)::int FROM audit_log) AS audits`,
  );

  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("AUTH_DEPENDENCY_UNAVAILABLE");
  expect(response.body).not.toMatch(/(?:injected|postgres|trigger|password_hash)/iu);
  expect(state.rows[0]).toEqual({ credentials: 0, activeFamilies: 1, audits: 0 });
});

it("serializes concurrent provisions to one credential and two committed transition audits", async () => {
  harness = await createUsersHarness("ccpo_password_concurrency");
  const target = harness.actors.get("finops_analyst")!;
  await insertFamily(harness, target);
  const responses = await Promise.all([put(harness, target, 2), put(harness, target, 3)]);
  const state = await harness.pool.query<{ credentials: number; audits: number; active: number }>(
    `SELECT (SELECT count(*)::int FROM user_auth_credentials) AS credentials,
      (SELECT count(*)::int FROM audit_log WHERE entity_id = $1) AS audits,
      (SELECT count(*)::int FROM auth_refresh_families WHERE user_id = $1 AND revoked_at IS NULL)
        AS active`,
    [target],
  );

  expect(responses.map((response) => response.statusCode)).toEqual([204, 204]);
  expect(state.rows[0]).toEqual({ credentials: 1, audits: 2, active: 0 });
});
