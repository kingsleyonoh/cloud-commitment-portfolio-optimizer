import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function createOpaqueSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function digestSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function digestSecretBase64url(value: string): string {
  return digestSecret(value).toString("base64url");
}

export function isCanonicalOpaqueSecret(value: unknown): value is string {
  if (typeof value !== "string" || !OPAQUE_PATTERN.test(value)) return false;
  return Buffer.from(value, "base64url").toString("base64url") === value;
}

export function safeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function safeDigestEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
