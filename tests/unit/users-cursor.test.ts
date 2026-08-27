import { describe, expect, it } from "vitest";

import { decodeUsersCursor, encodeUsersCursor } from "../../core/tenant/users-cursor.js";

const boundary = {
  createdAt: "2026-07-15T12:34:56.123456Z",
  id: "11111111-1111-4111-8111-111111111111",
};

describe("users keyset cursor", () => {
  it("round-trips one bounded canonical versioned opaque boundary", () => {
    const cursor = encodeUsersCursor(boundary);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(decodeUsersCursor(cursor)).toEqual(boundary);
  });

  it("rejects tampering, foreign versions, noncanonical base64url, and invalid boundaries", () => {
    const cursor = encodeUsersCursor(boundary);
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const cases = [
      `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`,
      Buffer.from(JSON.stringify({ ...decoded, v: 2 })).toString("base64url"),
      `${cursor}=`,
      Buffer.from(
        JSON.stringify({ ...decoded, id: "11111111-1111-4111-8111-111111111112" }),
      ).toString("base64url"),
      "x".repeat(513),
    ];

    for (const invalid of cases) {
      expect(() => decodeUsersCursor(invalid)).toThrowError(
        expect.objectContaining({ code: "VALIDATION_ERROR", statusCode: 400 }),
      );
    }
  });
});
