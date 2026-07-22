import { expect, it } from "vitest";

import { validateApiKeyRotationChains } from "../../core/tenant/initialization-rotation-chain.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_A = "2026-01-01T00:00:00.000001Z";
const ROTATED_B = "2026-01-02T00:00:00.000002Z";
const ROTATED_C = "2026-01-03T00:00:00.000003Z";

function key(id: string, tenantId: string, createdAt: string, revokedAt: string | null) {
  return { id, tenantId, createdAt, revokedAt };
}

function audit(oldId: string, replacementId: string, oldCreated: string, rotatedAt: string) {
  return {
    tenantId: TENANT_A,
    actorUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    actorType: "user",
    action: "api_key.rotated",
    entityType: "api_key",
    entityId: oldId,
    requestId: `request-${oldId}`,
    createdAt: rotatedAt,
    oldValues: { created_at: oldCreated, revoked_at: null },
    newValues: {
      result: "succeeded",
      revoked_at: rotatedAt,
      replacement: { id: replacementId, created_at: rotatedAt, revoked_at: null },
    },
  };
}

function validChain() {
  return {
    origins: [{ keyId: A, tenantId: TENANT_A }],
    keys: [
      key(A, TENANT_A, CREATED_A, ROTATED_B),
      key(B, TENANT_A, ROTATED_B, ROTATED_C),
      key(C, TENANT_A, ROTATED_C, null),
    ],
    audits: [audit(A, B, CREATED_A, ROTATED_B), audit(B, C, ROTATED_B, ROTATED_C)],
  };
}

it("resolves one unique contiguous same-tenant chain to its active current key", () => {
  expect(validateApiKeyRotationChains(validChain())).toEqual(new Map([[A, C]]));
});

it.each([
  ["gap", () => ({ ...validChain(), audits: validChain().audits.slice(1) })],
  [
    "branch",
    () => ({
      ...validChain(),
      keys: [
        ...validChain().keys,
        key("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", TENANT_A, ROTATED_B, null),
      ],
      audits: [
        ...validChain().audits,
        audit(A, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", CREATED_A, ROTATED_B),
      ],
    }),
  ],
  [
    "cycle",
    () => ({
      origins: [{ keyId: A, tenantId: TENANT_A }],
      keys: [key(A, TENANT_A, CREATED_A, ROTATED_B), key(B, TENANT_A, ROTATED_B, ROTATED_C)],
      audits: [audit(A, B, CREATED_A, ROTATED_B), audit(B, A, ROTATED_B, ROTATED_C)],
    }),
  ],
  [
    "cross-tenant link",
    () => ({
      origins: [{ keyId: A, tenantId: TENANT_A }],
      keys: [key(A, TENANT_A, CREATED_A, ROTATED_B), key(B, TENANT_B, ROTATED_B, null)],
      audits: [audit(A, B, CREATED_A, ROTATED_B)],
    }),
  ],
  [
    "malformed audit JSON",
    () => ({
      ...validChain(),
      audits: [
        {
          ...validChain().audits[0]!,
          newValues: { ...validChain().audits[0]!.newValues, note: "forbidden" },
        },
        validChain().audits[1]!,
      ],
    }),
  ],
  [
    "rogue row",
    () => ({
      ...validChain(),
      keys: [...validChain().keys, key(B.toUpperCase(), TENANT_A, ROTATED_C, null)],
    }),
  ],
])("rejects %s", (_label, scenario) => {
  expect(() => validateApiKeyRotationChains(scenario())).toThrowError(
    "Initialization rotation history is ambiguous.",
  );
});
