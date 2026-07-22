import { describe, expect, it } from "vitest";
import { apiKeyMetadataFixtures } from "../fixtures/api-key-metadata.js";
import { tenantFixtures } from "../fixtures/tenants.js";
import { canonicalUserRoles, userFixtures } from "../fixtures/users.js";

const metadataKeys = ["createdAt", "id", "note", "revokedAt", "tenantId"];
const userKeys = ["email", "id", "isActive", "name", "role", "tenantId"];
const forbiddenCredentialName = /(?:plaintext|prefix|hash|digest|token|password|secret)/iu;
const forbiddenCredentialValue =
  /(?:[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{10,}|sk_(?:live|test)_|github_pat_|gh[op]_|xox[bp]-|AKIA[0-9A-Z]{12})/u;

interface OwnedRecord {
  readonly tenantId: string;
  readonly email?: string;
  readonly name?: string;
  readonly note?: string;
}

function recordsByTenant<T extends { readonly tenantId: string }>(records: readonly T[]) {
  return Object.fromEntries(
    Object.values(tenantFixtures).map(({ id }) => [
      id,
      records.filter((record) => record.tenantId === id),
    ]),
  );
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...objectKeys(child)]);
}

function expectNoCrossTenantLeakage(records: readonly OwnedRecord[]): void {
  const grouped = recordsByTenant(records);
  const [firstTenant, secondTenant] = Object.keys(grouped);
  const pairs = [
    [firstTenant!, secondTenant!],
    [secondTenant!, firstTenant!],
  ] as const;
  for (const [owner, other] of pairs) {
    expect(JSON.stringify(grouped[owner])).not.toContain(other);
    for (const field of ["email", "name", "note"] as const) {
      for (const literal of grouped[other]!.flatMap((record) => record[field] ?? [])) {
        expect(JSON.stringify(grouped[owner])).not.toContain(literal);
      }
    }
  }
}

describe("separate typed user fixtures", () => {
  it("owns canonical lowercase login identities and all exact roles outside tenants", () => {
    expect(canonicalUserRoles).toEqual([
      "tenant_admin",
      "finops_analyst",
      "finance_approver",
      "read_only_auditor",
    ]);
    expect(new Set(userFixtures.map(({ role }) => role))).toEqual(new Set(canonicalUserRoles));
    for (const user of userFixtures) {
      expect(Object.keys(user).sort()).toEqual(userKeys);
      expect(user.email).toBe(user.email.toLowerCase());
      expect(user.email).toMatch(/^[^@\s]+@[^@\s]+$/u);
      expect(user.name).toBe(user.name.trim().normalize("NFC"));
      expect(typeof user.isActive).toBe("boolean");
      expect(Object.isFrozen(user)).toBe(true);
      expect(tenantFixtures).toSatisfy((tenants: typeof tenantFixtures) =>
        Object.values(tenants).some(({ id }) => id === user.tenantId),
      );
    }
    expect(
      Object.values(recordsByTenant(userFixtures)).every((records) => records.length >= 1),
    ).toBe(true);
  });
});

describe("safe API-key metadata fixtures", () => {
  it("keeps credential-shaped fields and token-like literals out of every fixture object", () => {
    const fixtureGraph = {
      tenants: tenantFixtures,
      users: userFixtures,
      metadata: apiKeyMetadataFixtures,
    };
    expect(objectKeys(fixtureGraph).every((key) => !forbiddenCredentialName.test(key))).toBe(true);
    expect(JSON.stringify(fixtureGraph)).not.toMatch(forbiddenCredentialValue);
  });

  it("contains only canonical serializable metadata with referential tenant ownership", () => {
    for (const metadata of apiKeyMetadataFixtures) {
      expect(Object.keys(metadata).sort()).toEqual(metadataKeys);
      expect(Object.keys(metadata).every((key) => !forbiddenCredentialName.test(key))).toBe(true);
      expect(JSON.stringify(metadata)).not.toMatch(forbiddenCredentialValue);
      expect(metadata.note).toBe(metadata.note.trim().normalize("NFC"));
      expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
      if (metadata.revokedAt !== null)
        expect(Date.parse(metadata.revokedAt)).toBeGreaterThanOrEqual(
          Date.parse(metadata.createdAt),
        );
      expect(Object.isFrozen(metadata)).toBe(true);
      expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
      expect(Object.values(tenantFixtures).some(({ id }) => id === metadata.tenantId)).toBe(true);
    }
    expect(
      Object.values(recordsByTenant(apiKeyMetadataFixtures)).every(
        (records) => records.length >= 1,
      ),
    ).toBe(true);
  });

  it("keeps every user and metadata literal out of the opposite tenant serialization", () => {
    expectNoCrossTenantLeakage(userFixtures);
    expectNoCrossTenantLeakage(apiKeyMetadataFixtures);
  });
});
