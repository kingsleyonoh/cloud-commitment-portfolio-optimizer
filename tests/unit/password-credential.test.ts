import { describe, expect, it } from "vitest";

import {
  ARGON2_POLICY,
  hashPassword,
  isAllowedPasswordPhc,
  verifyPassword,
} from "../../core/tenant/password-credential.js";
import { createArgonExecutor } from "../../core/tenant/argon-executor.js";
import { normalizePassword } from "../../core/tenant/password-policy.js";

function password(seed: number): string {
  return normalizePassword(
    Array.from({ length: 18 }, (_, index) =>
      String.fromCodePoint(0x41 + ((seed + index) % 26)),
    ).join(""),
  );
}

describe("Argon2id credential policy", () => {
  it("hashes and verifies only with the exact reviewed Argon2id policy", async () => {
    const executor = createArgonExecutor({ concurrency: 1, queueLimit: 2 });
    const first = await hashPassword(password(0), executor);
    const second = await hashPassword(password(0), executor);

    expect(ARGON2_POLICY).toEqual({
      algorithm: "argon2id",
      version: 19,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
      saltLength: 16,
      encodedLengthLimit: 512,
    });
    expect(first).not.toBe(second);
    expect(isAllowedPasswordPhc(first)).toBe(true);
    expect(await verifyPassword(first, password(0), executor)).toBe(true);
    expect(await verifyPassword(first, password(1), executor)).toBe(false);
  });

  it("rejects malformed or out-of-policy PHCs before invoking native verification", async () => {
    const executor = createArgonExecutor({ concurrency: 1, queueLimit: 1 });
    const valid = await hashPassword(password(2), executor);
    const parts = valid.split("$");
    const candidates = [
      valid.replace("argon2id", "argon2i"),
      valid.replace("v=19", "v=16"),
      valid.replace("m=65536", "m=32768"),
      valid.replace("t=3", "t=2"),
      valid.replace("p=1", "p=2"),
      [...parts.slice(0, 4), "***", parts[5]].join("$"),
      [...parts.slice(0, 5), `${parts[5]}A`].join("$"),
      `${valid}${"A".repeat(512)}`,
    ];

    for (const candidate of candidates) {
      expect(isAllowedPasswordPhc(candidate)).toBe(false);
      await expect(verifyPassword(candidate, password(2), executor)).resolves.toBe(false);
    }
    expect(executor.snapshot()).toEqual({ active: 0, queued: 0, closed: false });
  });
});
