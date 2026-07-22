import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createTenantProfileRepository } from "../../core/tenant/profile-repository.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function canonicalRow() {
  return {
    id: TENANT_ID,
    name: "Northwind Ω",
    legalName: "Northwind Ω Legal",
    fullLegalName: "Northwind Ω Holdings Limited",
    displayName: "Northwind Ω",
    address: { line1: "1 Long Lane", country_code: "GB" },
    registration: { GB: "REG-ONE" },
    contactEmail: null,
    contactPhone: null,
    supportUrl: null,
    financeOwnerEmail: null,
    wordmark: null,
    defaultCurrency: "GBP",
    timezone: "Europe/London",
    riskBudgetCents: "9223372036854775807",
    isActive: true,
    createdAt: new Date("2026-07-15T10:00:00.000Z"),
    updatedAt: new Date("2026-07-15T10:01:00.000Z"),
  };
}

describe("tenant profile repository", () => {
  it("uses one parameterized active-tenant query with the exact metadata projection", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
    const query = async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [canonicalRow()], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
    };
    const repository = createTenantProfileRepository({ query } as unknown as Pick<Pool, "query">);

    const result = await repository.findActiveById(TENANT_ID);

    expect(result).toEqual(canonicalRow());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual([TENANT_ID]);
    expect(calls[0]!.text.replace(/\s+/gu, " ").trim()).toBe(
      `SELECT id, name, legal_name AS "legalName", full_legal_name AS "fullLegalName", display_name AS "displayName", address, registration, contact_email AS "contactEmail", contact_phone AS "contactPhone", support_url AS "supportUrl", finance_owner_email AS "financeOwnerEmail", wordmark, default_currency AS "defaultCurrency", timezone, risk_budget_cents::text AS "riskBudgetCents", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt" FROM tenants WHERE id = $1 AND is_active = true LIMIT 1`,
    );
    expect(calls[0]!.text).not.toMatch(/\b(?:users|api_keys|key_hash|note)\b/iu);
  });

  it("returns null without fallback when the active tenant row is absent", async () => {
    const query = async () => ({ rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] });
    const repository = createTenantProfileRepository({ query } as unknown as Pick<Pool, "query">);

    await expect(repository.findActiveById(TENANT_ID)).resolves.toBeNull();
  });
});
