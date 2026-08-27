import * as argon2 from "argon2";

import type { ArgonExecutor } from "./argon-executor.js";
import { authError } from "./auth-errors.js";
import { normalizePassword } from "./password-policy.js";

export const ARGON2_POLICY = Object.freeze({
  algorithm: "argon2id",
  version: 19,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
  encodedLengthLimit: 512,
});

export async function hashPassword(password: string, executor: ArgonExecutor): Promise<string> {
  const normalized = normalizePassword(password);
  const encoded = await executor.run(() =>
    argon2.hash(normalized, {
      type: argon2.argon2id,
      version: ARGON2_POLICY.version,
      memoryCost: ARGON2_POLICY.memoryCost,
      timeCost: ARGON2_POLICY.timeCost,
      parallelism: ARGON2_POLICY.parallelism,
      hashLength: ARGON2_POLICY.hashLength,
    }),
  );
  if (!isAllowedPasswordPhc(encoded)) throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
  return encoded;
}

export async function verifyPassword(
  encoded: string,
  password: string,
  executor: ArgonExecutor,
): Promise<boolean> {
  const normalized = normalizePassword(password);
  if (!isAllowedPasswordPhc(encoded)) return false;
  return executor.run(() => argon2.verify(encoded, normalized));
}

export function isAllowedPasswordPhc(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > ARGON2_POLICY.encodedLengthLimit
  ) {
    return false;
  }
  const parts = value.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "" ||
    parts[1] !== ARGON2_POLICY.algorithm ||
    parts[2] !== `v=${ARGON2_POLICY.version}` ||
    parts[3] !==
      `m=${ARGON2_POLICY.memoryCost},t=${ARGON2_POLICY.timeCost},p=${ARGON2_POLICY.parallelism}`
  ) {
    return false;
  }
  const salt = decodeCanonicalBase64(parts[4]!);
  const hash = decodeCanonicalBase64(parts[5]!);
  return salt?.length === ARGON2_POLICY.saltLength && hash?.length === ARGON2_POLICY.hashLength;
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+$/u.test(value) || value.length % 4 === 1) return null;
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/u, "");
  return canonical === value ? decoded : null;
}
