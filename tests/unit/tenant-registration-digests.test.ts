import { createHash, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  canonicalRegistrationRequest,
  prepareRegistrationRequest,
  validateIdempotencyKey,
} from "../../core/tenant/registration-digests.js";

function runtimeKey(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

it("accepts one normalized visible-ASCII key and hashes only the normalized value", () => {
  const raw = runtimeKey();
  const normalized = validateIdempotencyKey(`  ${raw}  `);
  const prepared = prepareRegistrationRequest(raw, { name: "Tenant" });

  expect(normalized).toBe(raw);
  expect(prepared.idempotencyKeyHash).toEqual(createHash("sha256").update(raw, "utf8").digest());
  expect(prepared.idempotencyKeyHash).toHaveLength(32);
  expect(prepared.requestSha256).toHaveLength(32);
});

it("rejects missing, short, long, space-containing, control, and non-ASCII keys", () => {
  for (const key of [
    "",
    "short",
    "x".repeat(129),
    `${"x".repeat(16)} space`,
    `${"x".repeat(16)}\n`,
    `${"x".repeat(16)}é`,
  ]) {
    expect(() => validateIdempotencyKey(key)).toThrow();
  }
});

it("canonicalizes fixed fields/defaults and sorted normalized registration keys", () => {
  const first = prepareRegistrationRequest(runtimeKey(), {
    name: " Tenant ",
    registration: { vat: " V ", "tax.id": " T " },
  });
  const second = prepareRegistrationRequest(runtimeKey(), {
    registration: { "tax.id": "T", VAT: "V" },
    name: "Tenant",
  });

  expect(first.canonicalRequest).toBe(second.canonicalRequest);
  expect(first.requestSha256).toEqual(second.requestSha256);
  expect(first.canonicalRequest.startsWith("tenant-registration:v1\n")).toBe(true);
  expect(first.canonicalRequest).toContain('"risk_budget_cents":"0"');
  expect(first.canonicalRequest.indexOf('"TAX.ID"')).toBeLessThan(
    first.canonicalRequest.indexOf('"VAT"'),
  );
});

it("changes the request digest for a normalized semantic change", () => {
  const key = runtimeKey();
  const first = prepareRegistrationRequest(key, { name: "Tenant", riskBudgetCents: "0" });
  const second = prepareRegistrationRequest(key, { name: "Tenant", riskBudgetCents: "1" });

  expect(first.requestSha256.equals(second.requestSha256)).toBe(false);
  expect(canonicalRegistrationRequest(first.tenant)).not.toBe(
    canonicalRegistrationRequest(second.tenant),
  );
});
