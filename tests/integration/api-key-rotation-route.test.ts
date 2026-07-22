import { createHash, randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import {
  closeRotationHarness,
  createRotationHarness,
  rotationAuthorization,
  type RotationHarness,
} from "./helpers/api-key-rotation-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

interface SuccessParts {
  body: Record<string, unknown>;
  revoked: Record<string, unknown>;
  replacement: Record<string, unknown>;
}

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

it("commits selected revoke, replacement digest, and one exact secret-free audit before 200", async () => {
  const current = await fresh("ccpo_rotation_success");
  const response = await current.app.inject({
    method: "POST",
    url: "/api/api-keys/rotate",
    headers: rotationAuthorization(current),
    payload: { api_key_id: current.targetId },
  });
  expect(response.statusCode).toBe(200);
  const parts = assertResponseShape(current, response.json<Record<string, unknown>>());
  await assertStoredKeys(current, parts);
  await assertCanonicalAudit(current, parts);
});

function assertResponseShape(
  current: RotationHarness,
  body: Record<string, unknown>,
): SuccessParts {
  expect(Object.keys(body).sort()).toEqual([
    "apiKey",
    "audit_id",
    "replacement_api_key",
    "revoked_api_key",
  ]);
  expect(typeof body.apiKey).toBe("string");
  const revoked = body.revoked_api_key as Record<string, unknown>;
  const replacement = body.replacement_api_key as Record<string, unknown>;
  expect(Object.keys(revoked).sort()).toEqual(["created_at", "id", "note", "revoked_at"]);
  expect(Object.keys(replacement).sort()).toEqual(["created_at", "id", "note", "revoked_at"]);
  expect(revoked).toMatchObject({ id: current.targetId, note: "origin note" });
  expect(replacement).toMatchObject({ note: null, revoked_at: null });
  expect(revoked.revoked_at).toBe(replacement.created_at);
  expect(String(revoked.created_at)).toMatch(/\.\d{6}Z$/u);
  return { body, revoked, replacement };
}

async function assertStoredKeys(current: RotationHarness, parts: SuccessParts): Promise<void> {
  const rows = await current.pool.query<{
    id: string;
    keyHash: string;
    note: string | null;
    revokedAt: Date | null;
  }>(
    `SELECT id, key_hash AS "keyHash", note, revoked_at AS "revokedAt"
     FROM api_keys WHERE tenant_id = $1 ORDER BY created_at, id`,
    [current.tenantA],
  );
  const responseHash = createHash("sha256").update(String(parts.body.apiKey), "utf8").digest("hex");
  const stored = rows.rows.find((row) => row.id === parts.replacement.id)!;
  expect(rows.rows).toHaveLength(3);
  expect(rows.rows.find((row) => row.id === current.targetId)?.revokedAt).not.toBeNull();
  expect(responseHash === stored.keyHash).toBe(true);
  expect(stored.note).toBeNull();
}

async function assertCanonicalAudit(current: RotationHarness, parts: SuccessParts): Promise<void> {
  const audit = await current.pool.query<Record<string, unknown>>(
    `SELECT id, tenant_id AS "tenantId", actor_user_id AS "actorUserId",
      actor_type AS "actorType", action, entity_type AS "entityType",
      entity_id AS "entityId", request_id AS "requestId",
      to_char(created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
      old_values AS "oldValues", new_values AS "newValues"
     FROM audit_log`,
  );
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0]).toEqual(expectedAudit(current, parts));
  const serialized = JSON.stringify(audit.rows[0]);
  expect(serialized).not.toContain("origin note");
  expect(serialized).not.toContain(String(parts.body.apiKey));
  expect(serialized).not.toMatch(/keyHash|key_hash|authorization|token|header|body/iu);
  expect(current.logs.join("\n")).not.toContain(String(parts.body.apiKey));
}

function expectedAudit(current: RotationHarness, parts: SuccessParts): Record<string, unknown> {
  return {
    id: parts.body.audit_id,
    tenantId: current.tenantA,
    actorUserId: current.actors.get("tenant_admin"),
    actorType: "user",
    action: "api_key.rotated",
    entityType: "api_key",
    entityId: current.targetId,
    requestId: expect.any(String),
    createdAt: parts.revoked.revoked_at,
    oldValues: { created_at: parts.revoked.created_at, revoked_at: null },
    newValues: {
      result: "succeeded",
      revoked_at: parts.revoked.revoked_at,
      replacement: {
        id: parts.replacement.id,
        created_at: parts.replacement.created_at,
        revoked_at: null,
      },
    },
  };
}

it.each([
  ["missing", () => randomUUID()],
  ["revoked", (current: RotationHarness) => current.revokedId],
  ["cross-tenant", (current: RotationHarness) => current.crossTenantId],
])("returns the same 404 with no writes for %s targets", async (_label, target) => {
  const current = await fresh(`ccpo_rotation_${_label}`);
  const before = await current.pool.query(`SELECT count(*)::int AS count FROM api_keys`);
  const response = await current.app.inject({
    method: "POST",
    url: "/api/api-keys/rotate",
    headers: rotationAuthorization(current),
    payload: { api_key_id: target(current) },
  });
  const after = await current.pool.query(`SELECT count(*)::int AS count FROM api_keys`);
  const audit = await current.pool.query(`SELECT count(*)::int AS count FROM audit_log`);

  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({
    error: { code: "NOT_FOUND", message: "API key was not found.", details: [] },
  });
  expect(after.rows[0]).toEqual(before.rows[0]);
  expect(audit.rows[0]).toEqual({ count: 0 });
});
