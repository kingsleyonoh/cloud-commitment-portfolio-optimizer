import { describe, expect, it } from "vitest";

import {
  normalizeUserCreate,
  normalizeUserPatch,
  parseUserId,
  parseUserListQuery,
} from "../../core/tenant/users-input.js";

describe("users request normalization", () => {
  it("normalizes closed identity metadata without credentials", () => {
    expect(
      normalizeUserCreate({
        email: "  U\u0308SER@Example.Invalid  ",
        name: "  A\u0308da  ",
        role: "tenant_admin",
      }),
    ).toEqual({
      email: "üser@example.invalid",
      name: "Äda",
      role: "tenant_admin",
      isActive: true,
    });
  });

  it.each([
    {},
    { email: "a@example.invalid", name: "A", role: "owner" },
    { email: "a@@example.invalid", name: "A", role: "tenant_admin" },
    { email: "a@example.invalid", name: "A\u0000", role: "tenant_admin" },
    { email: "a@example.invalid", name: "A", role: "tenant_admin", is_active: "true" },
    { email: "a@example.invalid", name: "A", role: "tenant_admin", password: "forbidden" },
    { email: `${"a".repeat(245)}@example.invalid`, name: "A", role: "tenant_admin" },
  ])("rejects invalid or open create metadata %#", (value) => {
    expect(() => normalizeUserCreate(value)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR", statusCode: 400 }),
    );
  });

  it("requires an exact timestamp and at least one mutable patch field", () => {
    expect(
      normalizeUserPatch({
        expected_updated_at: "2026-07-15T12:34:56.123456Z",
        email: " Next@Example.Invalid ",
        is_active: false,
      }),
    ).toEqual({
      expectedUpdatedAt: "2026-07-15T12:34:56.123456Z",
      changes: { email: "next@example.invalid", isActive: false },
      changedFields: ["email", "is_active"],
    });
    for (const invalid of [
      { expected_updated_at: "2026-07-15T12:34:56.123456Z" },
      { role: "tenant_admin" },
      { expected_updated_at: "2026-07-15T12:34:56.123Z", role: "tenant_admin" },
      {
        expected_updated_at: "2026-07-15T12:34:56.123456Z",
        role: "tenant_admin",
        tenant_id: "11111111-1111-4111-8111-111111111111",
      },
    ]) {
      expect(() => normalizeUserPatch(invalid)).toThrowError(
        expect.objectContaining({ code: "VALIDATION_ERROR" }),
      );
    }
  });

  it("parses only canonical bounded query and path values", () => {
    expect(parseUserListQuery({})).toEqual({ limit: 25 });
    expect(parseUserListQuery({ limit: "100", cursor: "opaque" })).toEqual({
      limit: 100,
      cursor: "opaque",
    });
    expect(parseUserId("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    for (const invalid of [
      { limit: "0" },
      { limit: "01" },
      { limit: "101" },
      { limit: 25 },
      { tenant_id: "11111111-1111-4111-8111-111111111111" },
      { cursor: "x".repeat(513) },
    ]) {
      expect(() => parseUserListQuery(invalid)).toThrowError(
        expect.objectContaining({ code: "VALIDATION_ERROR" }),
      );
    }
    expect(() => parseUserId("11111111-1111-4111-8111-11111111111A")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});
