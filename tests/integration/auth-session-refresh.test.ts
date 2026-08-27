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

it("rotates one child in the stable family with bounded idle/absolute metadata and no routine audit", async () => {
  harness = await createAuthSessionHarness("ccpo_session_refresh");
  const loggedIn = await login(harness);
  const initial = responseCookies(loggedIn);
  const refreshed = await sessionRequest(harness, "/api/auth/refresh", initial);
  const rotated = responseCookies(refreshed);
  const state = await harness.pool.query<{
    families: number;
    tokens: number;
    used: number;
    current: number;
    roots: number;
    routineAudits: number;
  }>(
    `SELECT (SELECT count(*)::int FROM auth_refresh_families) AS families,
      (SELECT count(*)::int FROM auth_refresh_tokens) AS tokens,
      (SELECT count(*)::int FROM auth_refresh_tokens WHERE used_at IS NOT NULL) AS used,
      (SELECT count(*)::int FROM auth_refresh_tokens WHERE used_at IS NULL) AS current,
      (SELECT count(*)::int FROM auth_refresh_tokens WHERE parent_token_id IS NULL) AS roots,
      (SELECT count(*)::int FROM audit_log WHERE action LIKE '%refresh%' OR action LIKE '%rotated%')
        AS "routineAudits"`,
  );
  const session = refreshed.json().session as Record<string, string>;

  expect([loggedIn.statusCode, refreshed.statusCode]).toEqual([200, 200]);
  expect({
    accessRotated: rotated.ccpo_access !== initial.ccpo_access,
    refreshRotated: rotated.ccpo_refresh !== initial.ccpo_refresh,
    csrfRotated: rotated.ccpo_csrf !== initial.ccpo_csrf,
    idleBeforeAbsolute:
      Date.parse(session.refresh_idle_expires_at!) <=
      Date.parse(session.refresh_absolute_expires_at!),
  }).toEqual({
    accessRotated: true,
    refreshRotated: true,
    csrfRotated: true,
    idleBeforeAbsolute: true,
  });
  expect(state.rows[0]).toEqual({
    families: 1,
    tokens: 2,
    used: 1,
    current: 1,
    roots: 1,
    routineAudits: 0,
  });
});

it("turns a used-token replay into one family revocation and one secret-free audit", async () => {
  harness = await createAuthSessionHarness("ccpo_session_replay");
  const loggedIn = await login(harness);
  const initial = responseCookies(loggedIn);
  expect((await sessionRequest(harness, "/api/auth/refresh", initial)).statusCode).toBe(200);
  const replay = await sessionRequest(harness, "/api/auth/refresh", initial);
  const repeated = await sessionRequest(harness, "/api/auth/refresh", initial);
  const state = await harness.pool.query<{
    revoked: number;
    audits: number;
    safe: boolean;
  }>(
    `SELECT
      (SELECT count(*)::int FROM auth_refresh_families
       WHERE revoked_at IS NOT NULL AND revocation_reason='reuse_detected') AS revoked,
      (SELECT count(*)::int FROM audit_log
       WHERE action='user.login.refresh_reuse_detected') AS audits,
      (SELECT bool_and(actor_type='system' AND actor_user_id IS NULL AND entity_id=$1
       AND old_values IS NULL
       AND new_values='{"result":"family_revoked","reason":"reuse_detected"}'::jsonb)
       FROM audit_log WHERE action='user.login.refresh_reuse_detected') AS safe`,
    [harness.userId],
  );

  expect([replay.statusCode, repeated.statusCode]).toEqual([401, 401]);
  expect(replay.json().error.code).toBe("AUTH_INVALID");
  expect(replay.cookies.map((cookie) => cookie.name).sort()).toEqual([
    "ccpo_access",
    "ccpo_csrf",
    "ccpo_refresh",
  ]);
  expect(state.rows[0]).toEqual({ revoked: 1, audits: 1, safe: true });
});

it("serializes concurrent same-token rotation so the losing replay revokes every descendant", async () => {
  harness = await createAuthSessionHarness("ccpo_session_refresh_race");
  const initial = responseCookies(await login(harness));
  const responses = await Promise.all([
    sessionRequest(harness, "/api/auth/refresh", initial),
    sessionRequest(harness, "/api/auth/refresh", initial),
  ]);
  const state = await harness.pool.query<{
    tokens: number;
    activeFamilies: number;
    reuseAudits: number;
  }>(
    `SELECT (SELECT count(*)::int FROM auth_refresh_tokens) AS tokens,
      (SELECT count(*)::int FROM auth_refresh_families WHERE revoked_at IS NULL) AS "activeFamilies",
      (SELECT count(*)::int FROM audit_log WHERE action='user.login.refresh_reuse_detected')
       AS "reuseAudits"`,
  );

  expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
  expect(state.rows[0]).toEqual({ tokens: 2, activeFamilies: 0, reuseAudits: 1 });
});

it("revokes on confirmed inactivity after proof and returns exact 403 with one denial audit", async () => {
  harness = await createAuthSessionHarness("ccpo_session_refresh_inactive");
  const initial = responseCookies(await login(harness));
  await harness.pool.query("UPDATE users SET is_active=false WHERE id=$1", [harness.userId]);
  const response = await sessionRequest(harness, "/api/auth/refresh", initial);
  const state = await harness.pool.query<{ reason: string; audits: number }>(
    `SELECT f.revocation_reason AS reason,
      (SELECT count(*)::int FROM audit_log WHERE action='user.login.denied') AS audits
     FROM auth_refresh_families f WHERE f.user_id=$1`,
    [harness.userId],
  );

  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("USER_INACTIVE");
  expect(state.rows[0]).toEqual({ reason: "user_inactive", audits: 1 });
});

it("rolls current use and child insertion back together on rotation failure", async () => {
  harness = await createAuthSessionHarness("ccpo_session_refresh_child_rollback");
  const initial = responseCookies(await login(harness));
  await harness.pool
    .query(`CREATE FUNCTION fail_refresh_child() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.parent_token_id IS NOT NULL THEN RAISE EXCEPTION 'injected'; END IF;
    RETURN NEW; END $$`);
  await harness.pool
    .query(`CREATE TRIGGER fail_refresh_child_trigger BEFORE INSERT ON auth_refresh_tokens
    FOR EACH ROW EXECUTE FUNCTION fail_refresh_child()`);
  const response = await sessionRequest(harness, "/api/auth/refresh", initial);
  const state = await harness.pool.query<{ tokens: number; used: number; active: boolean }>(
    `SELECT (SELECT count(*)::int FROM auth_refresh_tokens) AS tokens,
      (SELECT count(*)::int FROM auth_refresh_tokens WHERE used_at IS NOT NULL) AS used,
      (revoked_at IS NULL) AS active FROM auth_refresh_families WHERE user_id=$1`,
    [harness.userId],
  );

  expect(response.statusCode).toBe(503);
  expect(response.body).not.toMatch(/(?:injected|postgres|trigger|token|cookie|digest)/iu);
  expect(state.rows[0]).toEqual({ tokens: 1, used: 0, active: true });
});

it("rolls reuse revocation back if its one audit cannot commit", async () => {
  harness = await createAuthSessionHarness("ccpo_session_refresh_rollback");
  const initial = responseCookies(await login(harness));
  expect((await sessionRequest(harness, "/api/auth/refresh", initial)).statusCode).toBe(200);
  await harness.pool
    .query(`CREATE FUNCTION fail_reuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='user.login.refresh_reuse_detected' THEN RAISE EXCEPTION 'injected'; END IF;
    RETURN NEW; END $$`);
  await harness.pool.query(`CREATE TRIGGER fail_reuse_audit_trigger BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION fail_reuse_audit()`);
  const response = await sessionRequest(harness, "/api/auth/refresh", initial);
  const family = await harness.pool.query<{ active: boolean; audits: number }>(
    `SELECT (revoked_at IS NULL) AS active,
      (SELECT count(*)::int FROM audit_log WHERE action='user.login.refresh_reuse_detected') AS audits
     FROM auth_refresh_families WHERE user_id=$1`,
    [harness.userId],
  );

  expect(response.statusCode).toBe(503);
  expect(response.body).not.toMatch(/(?:injected|postgres|trigger|token|cookie|digest)/iu);
  expect(family.rows[0]).toEqual({ active: true, audits: 0 });
});
