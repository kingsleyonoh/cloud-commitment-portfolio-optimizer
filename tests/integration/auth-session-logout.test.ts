import { afterEach, expect, it } from "vitest";

import {
  closeAuthSessionHarness,
  createAuthSessionHarness,
  login,
  responseCookies,
  sessionRequest,
  type AuthSessionHarness,
} from "./helpers/auth-session-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: AuthSessionHarness | undefined;

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeAuthSessionHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("makes missing refresh logout idempotent 204 and clears all exact cookies without CSRF", async () => {
  harness = await createAuthSessionHarness("ccpo_session_logout_missing");
  const response = await harness.app.inject({ method: "POST", url: "/api/auth/logout" });
  const clears = response.cookies.map((cookie) => ({
    name: cookie.name,
    valueEmpty: cookie.value === "",
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: cookie.secure === true,
  }));

  expect(response.statusCode).toBe(204);
  expect(response.body).toBe("");
  expect(clears).toEqual([
    {
      name: "ccpo_access",
      valueEmpty: true,
      path: "/",
      sameSite: "Strict",
      secure: false,
    },
    {
      name: "ccpo_refresh",
      valueEmpty: true,
      path: "/",
      sameSite: "Strict",
      secure: false,
    },
    {
      name: "ccpo_csrf",
      valueEmpty: true,
      path: "/",
      sameSite: "Strict",
      secure: false,
    },
  ]);
});

it("revokes a known current family once with one valid audit and keeps repeats audit-free", async () => {
  harness = await createAuthSessionHarness("ccpo_session_logout");
  const cookies = responseCookies(await login(harness));
  const first = await sessionRequest(harness, "/api/auth/logout", cookies);
  const second = await sessionRequest(harness, "/api/auth/logout", cookies);
  const state = await harness.pool.query<{ reason: string; audits: number; safe: boolean }>(
    `SELECT f.revocation_reason AS reason,
      (SELECT count(*)::int FROM audit_log WHERE action='user.logout.succeeded') AS audits,
      (SELECT bool_and(actor_type='user' AND actor_user_id=$1 AND entity_id=$1
        AND old_values IS NULL
        AND new_values='{"result":"succeeded","family_revoked":true}'::jsonb)
       FROM audit_log WHERE action='user.logout.succeeded') AS safe
     FROM auth_refresh_families f WHERE f.user_id=$1`,
    [harness.userId],
  );

  expect([first.statusCode, second.statusCode]).toEqual([204, 204]);
  expect(state.rows[0]).toEqual({ reason: "logout", audits: 1, safe: true });
});

it("accepts a known used ancestor for explicit logout without treating it as refresh replay", async () => {
  harness = await createAuthSessionHarness("ccpo_session_logout_used");
  const initial = responseCookies(await login(harness));
  expect((await sessionRequest(harness, "/api/auth/refresh", initial)).statusCode).toBe(200);
  const response = await sessionRequest(harness, "/api/auth/logout", initial);
  const state = await harness.pool.query<{
    reason: string;
    logoutAudits: number;
    reuseAudits: number;
  }>(
    `SELECT revocation_reason AS reason,
      (SELECT count(*)::int FROM audit_log WHERE action='user.logout.succeeded') AS "logoutAudits",
      (SELECT count(*)::int FROM audit_log WHERE action='user.login.refresh_reuse_detected') AS "reuseAudits"
     FROM auth_refresh_families WHERE user_id=$1`,
    [harness.userId],
  );

  expect(response.statusCode).toBe(204);
  expect(state.rows[0]).toEqual({ reason: "logout", logoutAudits: 1, reuseAudits: 0 });
});

it("requires proof for a presented cookie but keeps malformed or unknown state idempotent", async () => {
  harness = await createAuthSessionHarness("ccpo_session_logout_unknown");
  const malformedWithoutProof = await harness.app.inject({
    method: "POST",
    url: "/api/auth/logout",
    cookies: { ccpo_refresh: "malformed" },
  });
  const malformedWithProof = await harness.app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": "A".repeat(43),
    },
    cookies: { ccpo_refresh: "malformed", ccpo_csrf: "A".repeat(43) },
  });
  const headerConflict = await harness.app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { authorization: "Bearer stale" },
  });
  const audits = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_log WHERE action='user.logout.succeeded'",
  );

  expect([
    malformedWithoutProof.statusCode,
    malformedWithProof.statusCode,
    headerConflict.statusCode,
  ]).toEqual([403, 204, 401]);
  expect(malformedWithoutProof.json().error.code).toBe("CSRF_INVALID");
  expect(headerConflict.json().error.code).toBe("AUTH_CREDENTIAL_CONFLICT");
  expect(audits.rows[0]!.count).toBe(0);
});

it("returns 503 without claiming revocation when the logout audit cannot commit", async () => {
  harness = await createAuthSessionHarness("ccpo_session_logout_rollback");
  const cookies = responseCookies(await login(harness));
  await harness.pool
    .query(`CREATE FUNCTION fail_logout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='user.logout.succeeded' THEN RAISE EXCEPTION 'injected'; END IF;
    RETURN NEW; END $$`);
  await harness.pool.query(`CREATE TRIGGER fail_logout_audit_trigger BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION fail_logout_audit()`);
  const response = await sessionRequest(harness, "/api/auth/logout", cookies);
  const state = await harness.pool.query<{ active: boolean; audits: number }>(
    `SELECT (revoked_at IS NULL) AS active,
      (SELECT count(*)::int FROM audit_log WHERE action='user.logout.succeeded') AS audits
     FROM auth_refresh_families WHERE user_id=$1`,
    [harness.userId],
  );

  expect(response.statusCode).toBe(503);
  expect(response.cookies).toHaveLength(0);
  expect(response.body).not.toMatch(/(?:injected|postgres|trigger|token|cookie|digest)/iu);
  expect(state.rows[0]).toEqual({ active: true, audits: 0 });
});
