import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { createOpaqueSecret, digestSecret } from "../../core/tenant/auth-session-crypto.js";
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

it.each([
  ["idle", "now() + interval '22 days'", "now() - interval '1 millisecond'"],
  ["absolute", "now() - interval '1 millisecond'", "now() + interval '1 day'"],
])("rejects strict %s expiry without skew, rotation, or audit", async (_kind, absolute, idle) => {
  harness = await createAuthSessionHarness(`ccpo_session_${_kind}_expiry`);
  const familyId = randomUUID();
  const tokenId = randomUUID();
  const refresh = createOpaqueSecret();
  const csrf = createOpaqueSecret();
  await harness.pool.query(
    `INSERT INTO auth_refresh_families
      (id,tenant_id,user_id,absolute_expires_at,created_at,updated_at)
     VALUES ($1,$2,$3,${absolute},now()-interval '31 days',now()-interval '31 days')`,
    [familyId, harness.tenantId, harness.userId],
  );
  await harness.pool.query(
    `INSERT INTO auth_refresh_tokens
      (id,tenant_id,family_id,token_digest,csrf_digest,idle_expires_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,${idle},now()-interval '8 days',now()-interval '8 days')`,
    [tokenId, harness.tenantId, familyId, digestSecret(refresh), digestSecret(csrf)],
  );
  const response = await sessionRequest(harness, "/api/auth/refresh", {
    ccpo_refresh: refresh,
    ccpo_csrf: csrf,
  });
  const state = await harness.pool.query<{ tokens: number; audits: number; active: boolean }>(
    `SELECT (SELECT count(*)::int FROM auth_refresh_tokens WHERE family_id=$1) AS tokens,
      (SELECT count(*)::int FROM audit_log WHERE action LIKE '%refresh%') AS audits,
      (revoked_at IS NULL) AS active FROM auth_refresh_families WHERE id=$1`,
    [familyId],
  );

  expect(response.statusCode).toBe(401);
  expect(response.json().error.code).toBe("AUTH_INVALID");
  expect(state.rows[0]).toEqual({ tokens: 1, audits: 0, active: true });
});

it("enforces endpoint credential, origin, Fetch Metadata, CSRF, and body selection", async () => {
  harness = await createAuthSessionHarness("ccpo_session_selection");
  const loggedIn = await login(harness);
  const cookies = responseCookies(loggedIn);
  const accessOnly = { ccpo_access: cookies.ccpo_access! };
  const get = await harness.app.inject({
    method: "GET",
    url: "/api/session-probe",
    cookies: accessOnly,
  });
  const unsafeMissing = await harness.app.inject({
    method: "POST",
    url: "/api/session-probe",
    cookies: accessOnly,
  });
  const unsafeValid = await harness.app.inject({
    method: "POST",
    url: "/api/session-probe",
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": cookies.ccpo_csrf!,
    },
    cookies,
  });
  const formValid = await harness.app.inject({
    method: "POST",
    url: "/api/session-probe",
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams({ _csrf: cookies.ccpo_csrf! }).toString(),
    cookies,
  });
  const conflict = await harness.app.inject({
    method: "GET",
    url: "/api/session-probe",
    headers: { authorization: "Bearer malformed" },
    cookies: accessOnly,
  });
  const refreshBody = await harness.app.inject({
    method: "POST",
    url: "/api/auth/refresh",
    headers: { "content-type": "application/json" },
    payload: {},
    cookies,
  });
  const refreshMissing = await harness.app.inject({ method: "POST", url: "/api/auth/refresh" });

  expect([
    get.statusCode,
    unsafeMissing.statusCode,
    unsafeValid.statusCode,
    formValid.statusCode,
    conflict.statusCode,
    refreshBody.statusCode,
    refreshMissing.statusCode,
  ]).toEqual([200, 403, 200, 200, 401, 400, 401]);
  expect(unsafeMissing.json().error.code).toBe("CSRF_INVALID");
  expect(conflict.json().error.code).toBe("AUTH_CREDENTIAL_CONFLICT");
  expect(refreshBody.json().error.code).toBe("VALIDATION_ERROR");
  expect(refreshMissing.json().error.code).toBe("AUTH_REQUIRED");
});

it("rejects wrong login media, cross-origin/fetch requests, closed bodies, and transport caps", async () => {
  harness = await createAuthSessionHarness("ccpo_session_transport");
  const request = {
    tenant_id: harness.tenantId,
    email: "session-user@example.invalid",
    password: harness.password,
  };
  const wrongMedia = await harness.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: harness.origin, "content-type": "text/plain" },
    payload: JSON.stringify(request),
  });
  const crossOrigin = await harness.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: "http://localhost:8081", "content-type": "application/json" },
    payload: request,
  });
  const crossSite = await harness.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: {
      origin: harness.origin,
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
    },
    payload: request,
  });
  const closed = await login(harness, { extra: true });
  const oversized = await harness.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { ...request, password: "x".repeat(4096) },
  });

  expect([
    wrongMedia.statusCode,
    crossOrigin.statusCode,
    crossSite.statusCode,
    closed.statusCode,
    oversized.statusCode,
  ]).toEqual([400, 403, 403, 400, 413]);
  expect(crossOrigin.json().error.code).toBe("CSRF_INVALID");
  expect(oversized.json().error.code).toBe("PAYLOAD_TOO_LARGE");
});
