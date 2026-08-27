import { describe, expect, it } from "vitest";

import {
  decodeApiKeyMetadataCursor,
  encodeApiKeyMetadataCursor,
} from "../../core/tenant/api-key-metadata-cursor.js";

const boundary = {
  createdAt: "2026-01-02T03:04:05.123456Z",
  id: "11111111-1111-4111-8111-111111111111",
};

describe("API-key metadata cursor", () => {
  it("round-trips one strict versioned microsecond boundary", () => {
    const cursor = encodeApiKeyMetadataCursor(boundary);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(cursor).not.toContain(boundary.id);
    expect(decodeApiKeyMetadataCursor(cursor)).toEqual(boundary);
  });

  it("rejects byte tampering, noncanonical encoding, unknown members, and wrong precision", () => {
    const cursor = encodeApiKeyMetadataCursor(boundary);
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    const openPayload = Buffer.from(
      JSON.stringify({
        v: 1,
        created_at: boundary.createdAt,
        id: boundary.id,
        check: "x",
        extra: 1,
      }),
      "utf8",
    ).toString("base64url");
    const millisecondPayload = Buffer.from(
      JSON.stringify({ v: 1, created_at: "2026-01-02T03:04:05.123Z", id: boundary.id, check: "x" }),
      "utf8",
    ).toString("base64url");

    for (const value of [tampered, `${cursor}=`, openPayload, millisecondPayload]) {
      expect(() => decodeApiKeyMetadataCursor(value)).toThrowError(
        expect.objectContaining({ code: "VALIDATION_ERROR", statusCode: 400 }),
      );
    }
  });
});
