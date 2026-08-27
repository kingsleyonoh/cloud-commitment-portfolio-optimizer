import { describe, expect, it } from "vitest";
import { tenantFixtures } from "../fixtures/tenants.js";

const tenantKeys = [
  "address",
  "contactEmail",
  "contactPhone",
  "defaultCurrency",
  "displayName",
  "financeOwnerEmail",
  "fullLegalName",
  "id",
  "isActive",
  "legalName",
  "name",
  "registration",
  "riskBudgetCents",
  "supportUrl",
  "timezone",
  "wordmark",
] as const;
const addressKeys = ["country_code", "line1", "line2", "locality", "postal_code", "region"];
const forbiddenOwnershipKeys = [
  "apiKeyPrefix",
  "apiKeyHash",
  "keyHash",
  "users",
  "userEmail",
  "userRole",
];

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

describe("typed tenant identity fixtures", () => {
  it("matches the canonical credential-free identity and defaults contract exactly", () => {
    const fixtures = Object.values(tenantFixtures);
    expect(fixtures).toHaveLength(2);
    for (const fixture of fixtures) {
      expect(Object.keys(fixture).sort()).toEqual(tenantKeys);
      expect(Object.keys(fixture.address).sort()).toEqual(addressKeys);
      expect(Object.keys(fixture.registration)).toHaveLength(1);
      expect(Object.keys(fixture.registration).every((key) => key === key.toUpperCase())).toBe(
        true,
      );
      expect(Object.values(fixture.registration).every((value) => value.trim() === value)).toBe(
        true,
      );
      expect(fixture.address.country_code).toMatch(/^[A-Z]{2}$/u);
      expect(stringLeaves(fixture).every((value) => value === value.trim())).toBe(true);
      expect(stringLeaves(fixture).every((value) => value === value.normalize("NFC"))).toBe(true);
      expect(fixture.contactEmail).toMatch(/^[^@]+@[^@]+$/u);
      expect(fixture.financeOwnerEmail).toMatch(/^[^@]+@[^@]+$/u);
      expect(fixture.supportUrl).toMatch(/^https:\/\//u);
      expect(fixture.defaultCurrency).toMatch(/^[A-Z]{3}$/u);
      expect(fixture.riskBudgetCents).toBeGreaterThanOrEqual(0);
      expect(typeof fixture.isActive).toBe("boolean");
      for (const key of forbiddenOwnershipKeys) expect(fixture).not.toHaveProperty(key);
    }
  });

  it("preserves two strongly distinct Unicode, long-address, and jurisdiction leakage edges", () => {
    const [first, second] = Object.values(tenantFixtures);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(stringLeaves(first).some((value) => /[^\x00-\x7F]/u.test(value))).toBe(true);
    expect(Object.values(tenantFixtures).some(({ address }) => address.line1.length >= 80)).toBe(
      true,
    );
    expect(Object.keys(first!.registration)).not.toEqual(Object.keys(second!.registration));

    const firstJson = JSON.stringify(first);
    const secondJson = JSON.stringify(second);
    for (const literal of stringLeaves(first).filter((value) => value.length >= 4)) {
      expect(secondJson, `TENANT_IDENTITY_LEAK: ${literal}`).not.toContain(literal);
    }
    for (const literal of stringLeaves(second).filter((value) => value.length >= 4)) {
      expect(firstJson, `TENANT_IDENTITY_LEAK: ${literal}`).not.toContain(literal);
    }
  });

  it("is deeply immutable and serializes deterministically without changing shape", () => {
    for (const fixture of Object.values(tenantFixtures)) {
      expect(Object.isFrozen(fixture)).toBe(true);
      expect(Object.isFrozen(fixture.address)).toBe(true);
      expect(Object.isFrozen(fixture.registration)).toBe(true);
      expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
    }
  });
});
