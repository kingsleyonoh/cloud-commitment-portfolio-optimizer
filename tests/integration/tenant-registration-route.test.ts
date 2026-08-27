import { afterEach, expect, it } from "vitest";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeRegistrationHarness,
  createRegistrationHarness,
  runtimeIdempotencyKey,
  type RegistrationHarness,
} from "./helpers/registration-app.js";

let harness: RegistrationHarness | undefined;

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeRegistrationHarness(current);
  await dropIsolatedDatabase(current?.database);
});

function request(body: object, headers: Record<string, string> = {}) {
  return {
    method: "POST" as const,
    url: "/api/tenants/register",
    headers: {
      "content-type": "application/json",
      "idempotency-key": runtimeIdempotencyKey(),
      ...headers,
    },
    payload: body,
  };
}

it("returns the exact disabled envelope without touching limiter or database", async () => {
  harness = await createRegistrationHarness("ccpo_registration_disabled", { enabled: false });
  const before = await harness.pool.query(
    "SELECT count(*)::int AS count FROM registration_requests",
  );
  const response = await harness.app.inject(
    request({ name: "Disabled Tenant" }, { "idempotency-key": "invalid" }),
  );
  const after = await harness.pool.query(
    "SELECT count(*)::int AS count FROM registration_requests",
  );

  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({
    error: { code: "REGISTRATION_DISABLED", message: "Resource not found.", details: [] },
  });
  expect(before.rows[0]?.count).toBe(0);
  expect(after.rows[0]?.count).toBe(0);
});

it("rejects unknown fields instead of stripping them", async () => {
  harness = await createRegistrationHarness("ccpo_registration_strict");
  const response = await harness.app.inject(
    request({ name: "Strict Tenant", admin: { role: "tenant_admin" } }),
  );

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({
    error: {
      code: "VALIDATION_ERROR",
      message: "Registration request is invalid.",
      details: [],
    },
  });
  expect(
    (await harness.pool.query("SELECT count(*)::int AS count FROM registration_requests")).rows[0]
      ?.count,
  ).toBe(0);
});

it("maps malformed JSON, unsupported media, and body-size errors safely", async () => {
  harness = await createRegistrationHarness("ccpo_registration_parser");
  const key = runtimeIdempotencyKey();
  const [malformed, media, oversized] = await Promise.all([
    harness.app.inject({
      method: "POST",
      url: "/api/tenants/register",
      headers: { "content-type": "application/json", "idempotency-key": key },
      payload: "{",
    }),
    harness.app.inject({
      method: "POST",
      url: "/api/tenants/register",
      headers: { "content-type": "text/plain", "idempotency-key": runtimeIdempotencyKey() },
      payload: "synthetic",
    }),
    harness.app.inject(
      request({ name: "x".repeat(17_000) }, { "idempotency-key": runtimeIdempotencyKey() }),
    ),
  ]);

  expect(malformed.statusCode).toBe(400);
  expect(malformed.json().error.code).toBe("VALIDATION_ERROR");
  expect(media.statusCode).toBe(400);
  expect(media.json().error.code).toBe("VALIDATION_ERROR");
  expect(oversized.statusCode).toBe(413);
  expect(oversized.json()).toEqual({
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "Registration request exceeds 16384 bytes.",
      details: [],
    },
  });
});

it("requires a bounded visible-ASCII Idempotency-Key", async () => {
  harness = await createRegistrationHarness("ccpo_registration_header");
  const missing = await harness.app.inject({
    method: "POST",
    url: "/api/tenants/register",
    headers: { "content-type": "application/json" },
    payload: { name: "Tenant" },
  });
  const invalid = await harness.app.inject({
    method: "POST",
    url: "/api/tenants/register",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `${runtimeIdempotencyKey()} space`,
    },
    payload: { name: "Tenant" },
  });

  expect(missing.statusCode).toBe(400);
  expect(invalid.statusCode).toBe(400);
  expect(missing.json().error.code).toBe("VALIDATION_ERROR");
  expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
});

it("limits the sixth admitted invalid attempt and does not extend the window", async () => {
  let now = 1_000;
  harness = await createRegistrationHarness("ccpo_registration_local_limit", {
    clock: () => now,
  });
  for (let count = 0; count < 5; count += 1) {
    const admitted = await harness.app.inject(request({}));
    expect(admitted.statusCode).toBe(400);
  }
  const denied = await harness.app.inject(request({}));
  expect(denied.statusCode).toBe(429);
  expect(denied.headers["retry-after"]).toBe("60");
  expect(denied.json().error.code).toBe("RATE_LIMITED");

  now += 30_001;
  const deniedAgain = await harness.app.inject(request({}));
  expect(deniedAgain.headers["retry-after"]).toBe("30");
  expect(
    (await harness.pool.query("SELECT count(*)::int AS count FROM registration_requests")).rows[0]
      ?.count,
  ).toBe(0);
});

it("ignores forwarding spoofing by default and trusts only configured peers", async () => {
  harness = await createRegistrationHarness("ccpo_registration_proxy");
  for (let count = 0; count < 5; count += 1) {
    await harness.app.inject(request({}, { "x-forwarded-for": `192.0.2.${count + 1}` }));
  }
  expect(
    (await harness.app.inject(request({}, { "x-forwarded-for": "198.51.100.1" }))).statusCode,
  ).toBe(429);

  const untrusted = harness;
  harness = undefined;
  await closeRegistrationHarness(untrusted);
  await dropIsolatedDatabase(untrusted.database);

  harness = await createRegistrationHarness("ccpo_registration_trusted_proxy", {
    trustedProxyCidrs: ["127.0.0.1"],
  });
  for (let count = 0; count < 5; count += 1) {
    expect(
      (await harness.app.inject(request({}, { "x-forwarded-for": "192.0.2.50" }))).statusCode,
    ).toBe(400);
  }
  expect(
    (await harness.app.inject(request({}, { "x-forwarded-for": "192.0.2.50" }))).statusCode,
  ).toBe(429);
  expect(
    (await harness.app.inject(request({}, { "x-forwarded-for": "198.51.100.50" }))).statusCode,
  ).toBe(400);
});
