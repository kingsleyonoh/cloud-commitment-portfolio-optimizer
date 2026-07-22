import { createHash, timingSafeEqual } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  API_KEY_PAYLOAD_BYTES,
  API_KEY_VERSION,
  createApiKeyCredential,
  validateApiKeyPrefix,
} from "../../core/tenant/api-key-credential.js";

describe("first-run API key credential", () => {
  it("uses 32 CSPRNG bytes and emits the configured versioned base64url shape", () => {
    const randomSource = vi.fn((size: number) => Buffer.alloc(size, 7));
    const credential = createApiKeyCredential("ccpo", randomSource);
    const shapeIsValid = /^[a-z][a-z0-9]{0,15}_live_v1_[A-Za-z0-9_-]{43}$/u.test(
      credential.plaintext,
    );
    const payloadLength = credential.plaintext.split("_").at(-1)?.length ?? -1;

    expect(randomSource).toHaveBeenCalledOnce();
    expect(randomSource).toHaveBeenCalledWith(API_KEY_PAYLOAD_BYTES);
    expect(API_KEY_PAYLOAD_BYTES).toBe(32);
    expect(API_KEY_VERSION).toBe("v1");
    expect(shapeIsValid).toBe(true);
    expect(payloadLength).toBe(43);
  });

  it("stores only the lowercase SHA-256 digest of the full plaintext", () => {
    const credential = createApiKeyCredential("ccpo", (size) => Buffer.alloc(size, 19));
    const independentlyComputed = createHash("sha256")
      .update(credential.plaintext, "utf8")
      .digest();
    const storedDigest = Buffer.from(credential.keyHash, "hex");
    const lowerHexShape = /^[0-9a-f]{64}$/u.test(credential.keyHash);
    const digestMatches =
      storedDigest.length === independentlyComputed.length &&
      timingSafeEqual(storedDigest, independentlyComputed);

    expect(lowerHexShape).toBe(true);
    expect(credential.keyHash.length).toBe(64);
    expect(digestMatches).toBe(true);
  });

  it("accepts only bounded lowercase issuance prefixes", () => {
    for (const prefix of ["a", "ccpo", "a1", "abcdefghijklmnop"]) {
      expect(validateApiKeyPrefix(prefix)).toBe(prefix);
    }
    for (const prefix of ["", "CCPO", "1ccpo", "cc-po", "abcdefghijklmnopq"]) {
      expect(() => validateApiKeyPrefix(prefix)).toThrow(/API_KEY_PREFIX/iu);
    }
  });
});
