import { expect, it } from "vitest";
import { normalizeTenantInput, TenantInputValidationError } from "../../core/tenant/identity.js";

const completeInput = {
  name: "  Cafe\u0301 Portfolio  ",
  legalName: "  Café Holdings Ltd  ",
  address: {
    line1: "  1 Cloud Way  ",
    locality: "  Lagos  ",
    region: "  LA  ",
    postalCode: "  100001  ",
    countryCode: "  ng  ",
  },
  registration: { vat: "  NG-123  ", "tax.id": "  TI-42  " },
  contactEmail: "Finance@EXAMPLE.INVALID",
  contactPhone: "  +234 800 000 0000  ",
  supportUrl: "  https://support.example.invalid/help  ",
  financeOwnerEmail: "Owner@EXAMPLE.INVALID",
  wordmark: "  /assets/tenant.svg  ",
  defaultCurrency: " eur ",
  timezone: "America/New_York",
  riskBudgetCents: "9223372036854775807",
};

it("normalizes the complete closed tenant shape without numeric coercion", () => {
  expect(normalizeTenantInput(completeInput)).toEqual({
    name: "Café Portfolio",
    legalName: "Café Holdings Ltd",
    fullLegalName: "Café Holdings Ltd",
    displayName: "Café Portfolio",
    address: {
      line1: "1 Cloud Way",
      locality: "Lagos",
      region: "LA",
      postalCode: "100001",
      countryCode: "NG",
    },
    registration: { "TAX.ID": "TI-42", VAT: "NG-123" },
    contactEmail: "Finance@example.invalid",
    contactPhone: "+234 800 000 0000",
    supportUrl: "https://support.example.invalid/help",
    financeOwnerEmail: "Owner@example.invalid",
    wordmark: "/assets/tenant.svg",
    defaultCurrency: "EUR",
    timezone: "America/New_York",
    riskBudgetCents: "9223372036854775807",
  });
});

it("applies explicit empty/default values without inventing identity", () => {
  expect(
    normalizeTenantInput({
      name: "Tenant",
      address: {},
      registration: {},
      contactEmail: " ",
      contactPhone: " ",
      supportUrl: " ",
      financeOwnerEmail: " ",
      wordmark: " ",
    }),
  ).toMatchObject({
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

it("rejects address incompleteness, unsupported countries, and oversized fields", () => {
  for (const address of [
    { line1: "1 Way" },
    { line1: "1 Way", locality: "City", countryCode: "ZZ" },
    { line1: "x".repeat(201), locality: "City", countryCode: "US" },
  ]) {
    expect(() => normalizeTenantInput({ name: "Tenant", address })).toThrow(
      TenantInputValidationError,
    );
  }
});

it("rejects normalized registration collisions, blank values, and entry overflow", () => {
  expect(() =>
    normalizeTenantInput({ name: "Tenant", registration: { vat: "one", VAT: "two" } }),
  ).toThrow(TenantInputValidationError);
  expect(() => normalizeTenantInput({ name: "Tenant", registration: { vat: "  " } })).toThrow(
    TenantInputValidationError,
  );
  const overflow = Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [`J${index}`, `V${index}`]),
  );
  expect(() => normalizeTenantInput({ name: "Tenant", registration: overflow })).toThrow(
    TenantInputValidationError,
  );
});

it("rejects unsafe contacts, URL credentials, controls, and field caps", () => {
  for (const input of [
    { name: "Tenant", contactEmail: "not-an-email" },
    { name: "Tenant", supportUrl: "ftp://example.invalid/file" },
    { name: "Tenant", supportUrl: "https://user:pass@example.invalid/" },
    { name: "Tenant", contactPhone: "x".repeat(65) },
    { name: "Tenant\u0085Name" },
    { name: "x".repeat(201) },
  ]) {
    expect(() => normalizeTenantInput(input)).toThrow(TenantInputValidationError);
  }
});

it("rejects timezone aliases/case rewrites and unsupported currency", () => {
  for (const input of [
    { name: "Tenant", timezone: "US/Eastern" },
    { name: "Tenant", timezone: "utc" },
    { name: "Tenant", timezone: "Not/AZone" },
    { name: "Tenant", defaultCurrency: "ZZZ" },
  ]) {
    expect(() => normalizeTenantInput(input)).toThrow(TenantInputValidationError);
  }
});

it("requires canonical decimal strings bounded to signed BIGINT", () => {
  for (const value of [1, -1, "-1", "+1", "01", "1.0", "1e3", " 1", "9223372036854775808"]) {
    expect(() =>
      normalizeTenantInput({ name: "Tenant", riskBudgetCents: value as string }),
    ).toThrow(TenantInputValidationError);
  }
});
