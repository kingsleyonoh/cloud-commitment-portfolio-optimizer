import { describe, expect, it } from "vitest";
import { normalizeTenantInput } from "../../core/tenant/identity.js";

describe("shared tenant input normalization", () => {
  it("normalizes required names with NFC and derives missing legal/display names", () => {
    const tenant = normalizeTenantInput({ name: "  Cafe\u0301 Holdings  " });

    expect(tenant).toEqual({
      name: "Café Holdings",
      legalName: "Café Holdings",
      fullLegalName: "Café Holdings",
      displayName: "Café Holdings",
      address: {},
      registration: {},
      contactEmail: null,
      contactPhone: null,
      supportUrl: null,
      financeOwnerEmail: null,
      wordmark: null,
      defaultCurrency: "USD",
      timezone: "UTC",
      riskBudgetCents: "0",
    });
  });

  it("preserves case and internal punctuation while following the fallback chain", () => {
    const tenant = normalizeTenantInput({
      name: "  Acme — Ops  ",
      legalName: "  ACME, Ltd.  ",
      fullLegalName: "  ACME, Ltd. (Global)  ",
      displayName: "  Acme Ops  ",
    });

    expect(tenant.name).toBe("Acme — Ops");
    expect(tenant.legalName).toBe("ACME, Ltd.");
    expect(tenant.fullLegalName).toBe("ACME, Ltd. (Global)");
    expect(tenant.displayName).toBe("Acme Ops");
  });

  it("rejects blank required and explicitly supplied derived names", () => {
    expect(() => normalizeTenantInput({ name: " \t " })).toThrow(/name is required/iu);
    expect(() => normalizeTenantInput({ name: "Tenant", legalName: "  " })).toThrow(
      /legal name is required/iu,
    );
  });
});
