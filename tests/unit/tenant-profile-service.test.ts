import { describe, expect, it } from "vitest";

import type { TenantProfileRepository } from "../../core/tenant/profile-repository.js";
import { createTenantProfileService } from "../../core/tenant/profile-service.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function row() {
  return {
    id: TENANT_ID,
    name: "Tenant Ω",
    legalName: "Tenant Ω Legal",
    fullLegalName: "Tenant Ω Legal Limited",
    displayName: "Tenant Ω",
    address: { locality: "Łódź" },
    registration: { PL: "PL-Ω" },
    contactEmail: null,
    contactPhone: null,
    supportUrl: null,
    financeOwnerEmail: null,
    wordmark: null,
    defaultCurrency: "PLN",
    timezone: "Europe/Warsaw",
    riskBudgetCents: "9223372036854775807",
    isActive: true,
    createdAt: new Date("2026-07-15T10:00:00.000Z"),
    updatedAt: "2026-07-15T10:01:00.000Z",
  };
}

describe("tenant profile service", () => {
  it("maps canonical metadata without Number conversion", async () => {
    const repository: TenantProfileRepository = { findActiveById: async () => row() };
    const service = createTenantProfileService(repository);

    await expect(service.getCurrent(TENANT_ID)).resolves.toEqual({
      id: TENANT_ID,
      name: "Tenant Ω",
      legal_name: "Tenant Ω Legal",
      full_legal_name: "Tenant Ω Legal Limited",
      display_name: "Tenant Ω",
      address: { locality: "Łódź" },
      registration: { PL: "PL-Ω" },
      contact_email: null,
      contact_phone: null,
      support_url: null,
      finance_owner_email: null,
      wordmark: null,
      default_currency: "PLN",
      timezone: "Europe/Warsaw",
      risk_budget_cents: "9223372036854775807",
      is_active: true,
      created_at: "2026-07-15T10:00:00.000Z",
      updated_at: "2026-07-15T10:01:00.000Z",
    });
  });

  it("returns a non-enumerating 404 when the authenticated tenant vanishes", async () => {
    const repository: TenantProfileRepository = { findActiveById: async () => null };
    const service = createTenantProfileService(repository);

    await expect(service.getCurrent(TENANT_ID)).rejects.toMatchObject({
      code: "TENANT_PROFILE_NOT_FOUND",
      statusCode: 404,
      details: [],
    });
  });

  it("maps repository dependency failures to a sanitized 503", async () => {
    const repository: TenantProfileRepository = {
      findActiveById: async () => {
        throw new Error("database connection included private detail");
      },
    };
    const service = createTenantProfileService(repository);

    await expect(service.getCurrent(TENANT_ID)).rejects.toMatchObject({
      code: "TENANT_PROFILE_UNAVAILABLE",
      statusCode: 503,
      details: [],
    });
  });
});
