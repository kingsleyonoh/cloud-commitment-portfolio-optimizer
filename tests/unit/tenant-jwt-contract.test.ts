import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { loadJwtPublicKey, resolveJwtPublicKey } from "../../core/tenant/jwt-public-key.js";
import {
  validateJwtClaims,
  validateJwtProtectedHeader,
  type JwtClaimPolicy,
} from "../../core/tenant/jwt-validation.js";

const temporaryDirectories: string[] = [];
const NOW = 2_000_000_000;
const USER_ID = "abcdef12-3456-4789-abcd-ef1234567890";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const policy: JwtClaimPolicy = {
  issuer: "ccpo",
  audience: "ccpo-ui",
  maxLifetimeSeconds: 900,
  clockToleranceSeconds: 30,
};

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: policy.issuer,
    aud: policy.audience,
    sub: USER_ID,
    tenant_id: TENANT_ID,
    role: "finops_analyst",
    jti: "runtime-generated-id",
    iat: NOW,
    exp: NOW + 900,
    ...overrides,
  };
}

function compactWithHeader(header: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode(header)}.${encode({ probe: true })}.${encode("signature")}`;
}

function compactWithRawHeader(header: string): string {
  const encode = (value: string) => Buffer.from(value).toString("base64url");
  return `${encode(header)}.${encode("payload")}.${encode("signature")}`;
}

async function temporaryPath(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-jwt-test-"));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

it("accepts only a canonical typ JWT and RS256 protected header", () => {
  expect(validateJwtProtectedHeader(compactWithHeader({ typ: "JWT", alg: "RS256" }))).toEqual({
    typ: "JWT",
    alg: "RS256",
  });

  expect(() =>
    validateJwtProtectedHeader(compactWithRawHeader('{"typ":"JWT","alg":"HS256","alg":"RS256"}')),
  ).toThrowError(expect.objectContaining({ code: "AUTH_INVALID" }));

  for (const header of [
    { typ: "jwt", alg: "RS256" },
    { typ: "JWT", alg: "none" },
    { typ: "JWT", alg: "HS256" },
    { typ: "JWT", alg: "RS256", crit: [] },
    { typ: "JWT", alg: "RS256", jku: "https://keys.invalid" },
    { typ: "JWT", alg: "RS256", x5u: "https://keys.invalid" },
    { typ: "JWT", alg: "RS256", jwk: {} },
    { typ: "JWT", alg: "RS256", kid: "unconfigured-key" },
  ]) {
    expect(() => validateJwtProtectedHeader(compactWithHeader(header))).toThrowError(
      expect.objectContaining({ code: "AUTH_INVALID", statusCode: 401 }),
    );
  }
});

it("accepts exact required claims and temporal boundaries", () => {
  expect(validateJwtClaims(claims(), policy, NOW)).toEqual({
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: "finops_analyst",
  });
  expect(validateJwtClaims(claims({ iat: NOW + 30, exp: NOW + 31 }), policy, NOW)).toBeDefined();
  expect(validateJwtClaims(claims({ nbf: NOW + 30 }), policy, NOW)).toBeDefined();
});

it.each([
  ["missing issuer", { iss: undefined }],
  ["array audience", { aud: [policy.audience] }],
  ["wrong audience", { aud: "other" }],
  ["noncanonical subject", { sub: USER_ID.toUpperCase() }],
  ["tenant mismatch shape", { tenant_id: "not-a-uuid" }],
  ["unknown role", { role: "owner" }],
  ["blank jti", { jti: "   " }],
  ["future issued-at", { iat: NOW + 31, exp: NOW + 32 }],
  ["non-numeric issued-at", { iat: "now" }],
  ["non-increasing expiry", { exp: NOW }],
  ["excess lifetime", { exp: NOW + 901 }],
  ["future not-before", { nbf: NOW + 31 }],
])("rejects %s with one stable generic error", (_label, overrides) => {
  expect(() => validateJwtClaims(claims(overrides), policy, NOW)).toThrowError(
    expect.objectContaining({ code: "AUTH_INVALID", statusCode: 401, details: [] }),
  );
});

it("loads only a readable regular RSA public key of at least 2048 bits", async () => {
  const path = await temporaryPath("public.pem");
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(path, publicKey.export({ type: "spki", format: "pem" }));

  const loaded = await loadJwtPublicKey(path);

  expect(loaded.type).toBe("public");
  expect(loaded.asymmetricKeyType).toBe("rsa");
  expect(loaded.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(2048);
});

it("fails closed for missing, directory, malformed, non-RSA, and undersized keys", async () => {
  const missing = await temporaryPath("missing.pem");
  const malformed = await temporaryPath("malformed.pem");
  const elliptic = await temporaryPath("elliptic.pem");
  const undersized = await temporaryPath("undersized.pem");
  await writeFile(malformed, "not a public key");
  await writeFile(
    elliptic,
    generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({
      type: "spki",
      format: "pem",
    }),
  );
  await writeFile(
    undersized,
    generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({
      type: "spki",
      format: "pem",
    }),
  );

  for (const path of [missing, tmpdir(), malformed, elliptic, undersized]) {
    await expect(loadJwtPublicKey(path)).rejects.toThrowError(
      expect.objectContaining({ code: "JWT_PUBLIC_KEY_INVALID" }),
    );
  }
});

it("permits only an explicit non-production no-key path and never reads a private-key path", async () => {
  await expect(resolveJwtPublicKey({ nodeEnv: "production", publicKeyPath: "" })).rejects.toThrow(
    "JWT_PUBLIC_KEY_PATH",
  );
  await expect(
    resolveJwtPublicKey({ nodeEnv: "development", publicKeyPath: "" }),
  ).resolves.toBeNull();
});
