import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prepareRegistrationRequest } from "../../core/tenant/registration-digests.js";
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

function registrationRequest(key: string, name = "Atomic Tenant") {
  return {
    method: "POST" as const,
    url: "/api/tenants/register",
    headers: { "content-type": "application/json", "idempotency-key": key },
    payload: {
      name,
      address: { line1: "1 Test Way", locality: "Test City", country_code: "US" },
      default_currency: "EUR",
      risk_budget_cents: "9223372036854775807",
    },
  };
}

async function counts() {
  const result = await harness!.pool.query<{
    tenants: number;
    keys: number;
    receipts: number;
  }>(`SELECT
    (SELECT count(*)::int FROM tenants) AS tenants,
    (SELECT count(*)::int FROM api_keys) AS keys,
    (SELECT count(*)::int FROM registration_requests) AS receipts`);
  return result.rows[0]!;
}

it("commits one digest receipt, normalized tenant, and hash-only analyst key before 201", async () => {
  harness = await createRegistrationHarness("ccpo_registration_created");
  const key = runtimeIdempotencyKey();
  const response = await harness.app.inject(registrationRequest(key));
  const body = response.json<{
    tenant: Record<string, unknown>;
    apiKey: string;
  }>();

  expect(response.statusCode).toBe(201);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(typeof body.apiKey).toBe("string");
  expect(body.apiKey.startsWith("ccpo_live_v1_")).toBe(true);
  expect(body.tenant).toMatchObject({
    name: "Atomic Tenant",
    legal_name: "Atomic Tenant",
    address: { line1: "1 Test Way", locality: "Test City", country_code: "US" },
    default_currency: "EUR",
    risk_budget_cents: "9223372036854775807",
    is_active: true,
  });
  expect(await counts()).toEqual({ tenants: 1, keys: 1, receipts: 1 });

  const stored = await harness.pool.query<{
    keyHash: string;
    keyBytes: number;
    requestBytes: number;
    status: string;
  }>(`SELECT k.key_hash AS "keyHash",
      octet_length(r.idempotency_key_hash)::int AS "keyBytes",
      octet_length(r.request_sha256)::int AS "requestBytes", r.status
      FROM registration_requests r JOIN api_keys k ON k.id = r.api_key_id`);
  expect(stored.rows[0]).toMatchObject({ keyBytes: 32, requestBytes: 32, status: "succeeded" });
  expect(stored.rows[0]?.keyHash).toBe(
    createHash("sha256").update(body.apiKey, "utf8").digest("hex"),
  );
  expect(harness.logs.join("\n")).not.toContain(key);
  expect(harness.logs.join("\n")).not.toContain(body.apiKey);
  expect(harness.logs.join("\n")).not.toContain(stored.rows[0]!.keyHash);
});

it("returns non-replayable safe IDs for same-key success and generic conflict for changed body", async () => {
  harness = await createRegistrationHarness("ccpo_registration_replay");
  const key = runtimeIdempotencyKey();
  const created = await harness.app.inject(registrationRequest(key));
  const lostResponse = created.json<{ apiKey: string }>();
  expect(typeof lostResponse.apiKey).toBe("string");

  const replay = await harness.app.inject(registrationRequest(key));
  expect(replay.statusCode).toBe(409);
  expect(replay.json()).toMatchObject({
    error: {
      code: "IDEMPOTENCY_RESULT_NOT_REPLAYABLE",
      message: "Registration credentials cannot be replayed.",
      details: [{ tenant_id: expect.any(String), api_key_id: expect.any(String) }],
    },
  });
  expect(replay.body).not.toContain("apiKey");

  const changed = await harness.app.inject(registrationRequest(key, "Changed Tenant"));
  expect(changed.statusCode).toBe(409);
  expect(changed.json()).toEqual({
    error: {
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "Idempotency key was already used for a different request.",
      details: [],
    },
  });
  expect(await counts()).toEqual({ tenants: 1, keys: 1, receipts: 1 });
});

it("creates exactly one tenant/key/receipt under identical concurrency", async () => {
  harness = await createRegistrationHarness("ccpo_registration_concurrent", {
    trustedProxyCidrs: ["127.0.0.1"],
  });
  const key = runtimeIdempotencyKey();
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) => {
      const baseRequest = registrationRequest(key);
      return harness!.app.inject({
        ...baseRequest,
        headers: { ...baseRequest.headers, "x-forwarded-for": `192.0.2.${index + 1}` },
      });
    }),
  );

  expect(responses.filter(({ statusCode }) => statusCode === 201)).toHaveLength(1);
  expect(responses.filter(({ statusCode }) => statusCode === 409)).toHaveLength(7);
  expect(responses.filter(({ body }) => body.includes("apiKey"))).toHaveLength(1);
  expect(await counts()).toEqual({ tenants: 1, keys: 1, receipts: 1 });
});

it("rolls back ledger and tenant when key creation fails", async () => {
  harness = await createRegistrationHarness("ccpo_registration_rollback");
  await harness.pool.query(`CREATE FUNCTION reject_registration_key() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END; $$;
      CREATE TRIGGER reject_registration_key BEFORE INSERT ON api_keys
      FOR EACH ROW EXECUTE FUNCTION reject_registration_key();`);

  const response = await harness.app.inject(registrationRequest(runtimeIdempotencyKey()));
  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("REGISTRATION_DEPENDENCY_UNAVAILABLE");
  expect(response.body).not.toContain("synthetic failure");
  expect(await counts()).toEqual({ tenants: 0, keys: 0, receipts: 0 });
});

it("maps durable pending and failed states without mutation or secret disclosure", async () => {
  harness = await createRegistrationHarness("ccpo_registration_states");
  const body = { name: "State Tenant" };
  const pendingKey = runtimeIdempotencyKey();
  const pending = prepareRegistrationRequest(pendingKey, body);
  await harness.pool.query(
    `INSERT INTO registration_requests (idempotency_key_hash, request_sha256)
       VALUES ($1, $2)`,
    [pending.idempotencyKeyHash, pending.requestSha256],
  );
  const pendingResponse = await harness.app.inject({
    ...registrationRequest(pendingKey),
    payload: body,
  });
  expect(pendingResponse.statusCode).toBe(409);
  expect(pendingResponse.headers["retry-after"]).toBe("1");
  expect(pendingResponse.json().error.code).toBe("IDEMPOTENCY_IN_PROGRESS");

  const failedKey = runtimeIdempotencyKey();
  const failed = prepareRegistrationRequest(failedKey, body);
  await harness.pool.query(
    `INSERT INTO registration_requests
        (idempotency_key_hash, request_sha256, status, error_code)
       VALUES ($1, $2, 'failed', 'REGISTRATION_TERMINAL')`,
    [failed.idempotencyKeyHash, failed.requestSha256],
  );
  const failedResponse = await harness.app.inject({
    ...registrationRequest(failedKey),
    payload: body,
  });
  expect(failedResponse.statusCode).toBe(409);
  expect(failedResponse.json().error.code).toBe("IDEMPOTENCY_TERMINAL_FAILURE");
  expect(await counts()).toEqual({ tenants: 0, keys: 0, receipts: 2 });
});
