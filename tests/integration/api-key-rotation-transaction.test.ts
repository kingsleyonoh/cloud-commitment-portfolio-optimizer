import { afterEach, expect, it } from "vitest";

import {
  closeRotationHarness,
  createRotationHarness,
  rotationAuthorization,
  type RotationHarness,
} from "./helpers/api-key-rotation-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: RotationHarness | undefined;

async function fresh(prefix: string): Promise<RotationHarness> {
  harness = await createRotationHarness(prefix);
  return harness;
}

afterEach(async () => {
  const database = harness?.database;
  await closeRotationHarness(harness);
  await dropIsolatedDatabase(database);
  harness = undefined;
});

async function rotate(current: RotationHarness, apiKeyId: string, note?: string) {
  return current.app.inject({
    method: "POST",
    url: "/api/api-keys/rotate",
    headers: rotationAuthorization(current),
    payload: { api_key_id: apiKeyId, ...(note === undefined ? {} : { note }) },
  });
}

async function tenantCounts(current: RotationHarness) {
  const result = await current.pool.query<{
    keys: number;
    active: number;
    audits: number;
  }>(
    `SELECT
      (SELECT count(*)::int FROM api_keys WHERE tenant_id = $1) AS keys,
      (SELECT count(*)::int FROM api_keys WHERE tenant_id = $1 AND revoked_at IS NULL) AS active,
      (SELECT count(*)::int FROM audit_log WHERE tenant_id = $1) AS audits`,
    [current.tenantA],
  );
  return result.rows[0];
}

it("serializes two clients on one selected key as one 200 and one identical 404", async () => {
  const current = await fresh("ccpo_rotation_concurrent");
  const responses = await Promise.all([
    rotate(current, current.targetId),
    rotate(current, current.targetId),
  ]);

  expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 404]);
  expect(responses.find((response) => response.statusCode === 404)?.json()).toEqual({
    error: { code: "NOT_FOUND", message: "API key was not found.", details: [] },
  });
  expect(await tenantCounts(current)).toEqual({ keys: 3, active: 1, audits: 1 });
});

it.each([
  ["replacement", "api_keys", "NEW.note = 'rollback replacement'"],
  ["audit", "audit_log", "NEW.action = 'api_key.rotated'"],
])("rolls back old, replacement, and audit on injected %s failure", async (kind, table, when) => {
  const current = await fresh(`ccpo_rotation_rollback_${kind}`);
  await current.pool.query(`CREATE FUNCTION fail_rotation_${kind}() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN IF ${when} THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
  await current.pool.query(`CREATE TRIGGER fail_rotation_${kind}_trigger BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION fail_rotation_${kind}()`);

  const response = await rotate(current, current.targetId, "rollback replacement");

  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({
    error: {
      code: "API_KEY_ROTATION_UNAVAILABLE",
      message: "API-key rotation is temporarily unavailable.",
      details: [],
    },
  });
  expect(await tenantCounts(current)).toEqual({ keys: 2, active: 1, audits: 0 });
  const old = await current.pool.query<{ revokedAt: Date | null }>(
    `SELECT revoked_at AS "revokedAt" FROM api_keys WHERE id = $1`,
    [current.targetId],
  );
  expect(old.rows[0]?.revokedAt).toBeNull();
});

it("does not replay a lost committed response and permits a deliberate next rotation", async () => {
  const current = await fresh("ccpo_rotation_lost_response");
  const first = await rotate(current, current.targetId, "successor one");
  expect(first.statusCode).toBe(200);
  const firstBody = first.json<Record<string, unknown>>();
  const replacementId = (firstBody.replacement_api_key as { id: string }).id;

  const lostRetry = await rotate(current, current.targetId);
  expect(lostRetry.statusCode).toBe(404);
  expect(await tenantCounts(current)).toEqual({ keys: 3, active: 1, audits: 1 });

  const deliberateNext = await rotate(current, replacementId, "successor two");
  expect(deliberateNext.statusCode).toBe(200);
  expect(await tenantCounts(current)).toEqual({ keys: 4, active: 1, audits: 2 });
  const origins = await current.pool.query<{ note: string | null }>(
    `SELECT note FROM api_keys WHERE id IN ($1, $2) ORDER BY created_at`,
    [current.targetId, replacementId],
  );
  expect(origins.rows.map((row) => row.note)).toEqual(["origin note", "successor one"]);
});
