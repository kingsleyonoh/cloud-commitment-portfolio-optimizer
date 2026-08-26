import { afterEach, expect, it } from "vitest";

import {
  closeAuthSessionHarness,
  createAuthSessionHarness,
  generatedPassword,
  login,
  responseCookies,
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

it("commits one stable family, root token, safe audit, exact metadata, and exact no-kid cookies", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login");
  const response = await login(harness);
  const cookies = response.cookies.map((cookie) => ({
    name: cookie.name,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAgePositive: Number(cookie.maxAge) > 0,
  }));
  const values = responseCookies(response);
  const header = JSON.parse(
    Buffer.from(values.ccpo_access!.split(".", 1)[0]!, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  const payload = JSON.parse(
    Buffer.from(values.ccpo_access!.split(".")[1]!, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  const state = await harness.pool.query<{
    families: number;
    tokens: number;
    audits: number;
    safe: boolean;
  }>(
    `SELECT
      (SELECT count(*)::int FROM auth_refresh_families WHERE user_id=$1) AS families,
      (SELECT count(*)::int FROM auth_refresh_tokens) AS tokens,
      (SELECT count(*)::int FROM audit_log WHERE action='user.login.succeeded') AS audits,
      (SELECT bool_and(actor_type='user' AND actor_user_id=$1 AND entity_id=$1
        AND old_values IS NULL AND new_values='{"result":"succeeded"}'::jsonb)
       FROM audit_log WHERE action='user.login.succeeded') AS safe`,
    [harness.userId],
  );

  expect(response.statusCode).toBe(200);
  expect(Object.keys(response.json().session).sort()).toEqual([
    "access_expires_at",
    "refresh_absolute_expires_at",
    "refresh_idle_expires_at",
    "role",
    "tenant_id",
    "user_id",
  ]);
  expect(response.body).not.toMatch(/(?:token|csrf|password|cookie|digest|email)/iu);
  expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  expect({
    hasSid: typeof payload.sid === "string",
    hasCsrfHash: typeof payload.csrf_hash === "string",
    issuer: payload.iss,
    audience: payload.aud,
    role: payload.role,
  }).toEqual({
    hasSid: true,
    hasCsrfHash: true,
    issuer: "ccpo",
    audience: "ccpo-ui",
    role: "finops_analyst",
  });
  expect(cookies).toEqual([
    {
      name: "ccpo_access",
      secure: false,
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAgePositive: true,
    },
    {
      name: "ccpo_refresh",
      secure: false,
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAgePositive: true,
    },
    {
      name: "ccpo_csrf",
      secure: false,
      httpOnly: false,
      sameSite: "Strict",
      path: "/",
      maxAgePositive: true,
    },
  ]);
  expect(state.rows[0]).toEqual({ families: 1, tokens: 1, audits: 1, safe: true });
});

it("renders a script-free login page with JWT and API-key boundary copy", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login_page");
  const response = await harness.app.inject({
    method: "GET",
    url: "/login",
    headers: { accept: "text/html" },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("text/html");
  expect(response.body).toContain("<form");
  expect(response.body).toContain('action="/login"');
  expect(response.body).toContain('name="tenant_id"');
  expect(response.body).toContain('name="email"');
  expect(response.body).toContain('name="password"');
  expect(response.body).toContain("JWT session");
  expect(response.body).toContain("API keys are for analyst automation");
  expect(response.body).not.toMatch(/<script|apiKey|key_hash|token|csrf|passwordHash/iu);
});

it("issues session cookies from the HTML login form without exposing tokens", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login_form");
  const response = await harness.app.inject({
    method: "POST",
    url: "/login",
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams({
      tenant_id: harness.tenantId,
      email: "session-user@example.invalid",
      password: harness.password,
    }).toString(),
  });
  const cookies = responseCookies(response);

  expect(response.statusCode).toBe(303);
  expect(response.headers.location).toBe("/dashboard");
  expect(Object.keys(cookies).sort()).toEqual(["ccpo_access", "ccpo_csrf", "ccpo_refresh"]);
  expect(response.body).not.toMatch(/(?:token|csrf|password|cookie|digest|email)/iu);
});

it("renders invalid HTML login attempts as a safe focused error summary", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login_form_invalid");
  const response = await harness.app.inject({
    method: "POST",
    url: "/login",
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams({
      tenant_id: harness.tenantId,
      email: "session-user@example.invalid",
      password: generatedPassword(14),
    }).toString(),
  });

  expect(response.statusCode).toBe(401);
  expect(response.headers["content-type"]).toContain("text/html");
  expect(response.body).toContain('role="alert"');
  expect(response.body).toContain("Authentication credentials are invalid.");
  expect(response.body).toContain(`value="${harness.tenantId}"`);
  expect(response.body).toContain('value="session-user@example.invalid"');
  expect(response.body).not.toContain(generatedPassword(14));
  expect(response.body).not.toMatch(/(?:ccpo_access|ccpo_refresh|digest|stack|postgres)/iu);
});

it("keeps unknown, unprovisioned, and wrong password failures identical without durable audit", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login_invalid");
  await harness.pool.query(
    `INSERT INTO users (tenant_id,email,name,role)
     VALUES ($1,'unprovisioned@example.invalid','unprovisioned','finops_analyst')`,
    [harness.tenantId],
  );
  const responses = await Promise.all([
    login(harness, { email: "unknown@example.invalid" }),
    login(harness, { email: "unprovisioned@example.invalid" }),
    login(harness, { password: generatedPassword(14) }),
  ]);
  const audits = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_log WHERE action LIKE 'user.login.%'",
  );

  expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401]);
  expect(new Set(responses.map((response) => response.body)).size).toBe(1);
  expect(responses[0]!.json().error).toEqual({
    code: "AUTH_INVALID",
    message: "Authentication credentials are invalid.",
    details: [],
  });
  expect(audits.rows[0]!.count).toBe(0);
  expect(harness.logs.filter((record) => record.level === "error")).toHaveLength(0);
  expect(
    harness.logs.filter(
      (record) => record.level === "info" && record.event === "http.request.rejected",
    ).length,
  ).toBeGreaterThanOrEqual(3);
});

it("returns generic 429 with Retry-After after five admitted account attempts", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login_rate");
  const responses = [];
  for (let index = 0; index < 6; index += 1) {
    responses.push(await login(harness, { email: "rate-target@example.invalid" }));
  }
  const audits = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_log WHERE action LIKE 'user.login.%'",
  );

  expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401, 401, 429]);
  expect(responses[5]!.json().error.code).toBe("RATE_LIMITED");
  expect(Number(responses[5]!.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  expect(audits.rows[0]!.count).toBe(0);
  expect(
    harness.logs.filter(
      (record) => record.level === "warn" && record.event === "http.request.rejected",
    ),
  ).toHaveLength(1);
});

it("audits a confirmed inactive proof and rolls back family plus audit when audit insertion fails", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login_inactive");
  await harness.pool.query("UPDATE users SET is_active=false WHERE id=$1", [harness.userId]);
  const inactive = await login(harness);
  await harness.pool.query("UPDATE users SET is_active=true WHERE id=$1", [harness.userId]);
  await harness.pool
    .query(`CREATE FUNCTION fail_login_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='user.login.succeeded' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
  await harness.pool.query(`CREATE TRIGGER fail_login_audit_trigger BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION fail_login_audit()`);
  const failed = await login(harness);
  const state = await harness.pool.query<{ families: number; denied: number; succeeded: number }>(
    `SELECT (SELECT count(*)::int FROM auth_refresh_families) AS families,
      (SELECT count(*)::int FROM audit_log WHERE action='user.login.denied') AS denied,
      (SELECT count(*)::int FROM audit_log WHERE action='user.login.succeeded') AS succeeded`,
  );

  expect(inactive.statusCode).toBe(403);
  expect(inactive.json().error.code).toBe("USER_INACTIVE");
  expect(failed.statusCode).toBe(503);
  expect(failed.body).not.toMatch(/(?:injected|postgres|trigger|password|token|digest)/iu);
  expect(state.rows[0]).toEqual({ families: 0, denied: 1, succeeded: 0 });
  expect(
    harness.logs.filter(
      (record) => record.level === "error" && record.event === "http.request.failed",
    ),
  ).toHaveLength(1);
});

it("ignores stale cookies on login, rejects credential headers, and permits a lost-response relogin", async () => {
  harness = await createAuthSessionHarness("ccpo_session_login_transport");
  const stale = await harness.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      authorization: "Bearer stale",
    },
    cookies: { ccpo_access: "stale", ccpo_refresh: "stale", ccpo_csrf: "stale" },
    payload: {
      tenant_id: harness.tenantId,
      email: "session-user@example.invalid",
      password: harness.password,
    },
  });
  const staleOnly = await harness.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: harness.origin, "content-type": "application/json" },
    cookies: { ccpo_access: "stale", ccpo_refresh: "stale", ccpo_csrf: "stale" },
    payload: {
      tenant_id: harness.tenantId,
      email: "session-user@example.invalid",
      password: harness.password,
    },
  });
  const first = await login(harness);
  const second = await login(harness);
  const families = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM auth_refresh_families WHERE user_id=$1",
    [harness.userId],
  );

  expect(stale.statusCode).toBe(401);
  expect(stale.json().error.code).toBe("AUTH_CREDENTIAL_CONFLICT");
  expect([staleOnly.statusCode, first.statusCode, second.statusCode]).toEqual([200, 200, 200]);
  expect(families.rows[0]!.count).toBe(3);
});
