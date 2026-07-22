import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyReply } from "fastify";
import { afterEach, expect, it, vi } from "vitest";

import { parseEnvironment } from "../../core/config/env.js";
import { parseAuth } from "../../core/config/env-runtime.js";
import {
  clearSessionCookies,
  createSessionCookiePolicy,
  setSessionCookies,
} from "../../core/tenant/auth-session-cookie.js";
import type { SessionIssue } from "../../core/tenant/auth-session-types.js";
import { resolveJwtKeyPair } from "../../core/tenant/jwt-key-pair.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function keyPaths(mismatch = false): Promise<{ publicPath: string; privatePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-session-keys-"));
  directories.push(directory);
  const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const verifier = mismatch ? generateKeyPairSync("rsa", { modulusLength: 2048 }) : signing;
  const publicPath = join(directory, "public.pem");
  const privatePath = join(directory, "private.pem");
  await writeFile(publicPath, verifier.publicKey.export({ type: "spki", format: "pem" }));
  await writeFile(privatePath, signing.privateKey.export({ type: "pkcs8", format: "pem" }));
  return { publicPath, privatePath };
}

it("loads one regular RSA 2048-or-larger matching issuance pair", async () => {
  const paths = await keyPaths();
  const pair = await resolveJwtKeyPair({
    nodeEnv: "production",
    publicKeyPath: paths.publicPath,
    privateKeyPath: paths.privatePath,
  });

  expect(pair.publicKey?.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(2048);
  expect(pair.privateKey?.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(2048);
});

it("fails startup for mismatched, malformed, missing, and non-regular issuance keys", async () => {
  const mismatch = await keyPaths(true);
  await expect(
    resolveJwtKeyPair({
      nodeEnv: "production",
      publicKeyPath: mismatch.publicPath,
      privateKeyPath: mismatch.privatePath,
    }),
  ).rejects.toMatchObject({ code: "JWT_SIGNING_KEY_INVALID" });

  const valid = await keyPaths();
  await writeFile(valid.privatePath, "malformed");
  await expect(
    resolveJwtKeyPair({
      nodeEnv: "production",
      publicKeyPath: valid.publicPath,
      privateKeyPath: valid.privatePath,
    }),
  ).rejects.toMatchObject({ code: "JWT_SIGNING_KEY_INVALID" });
});

it("requires production Redis, secure cookies, and both signing paths", () => {
  const complete = {
    JWT_ISSUER: "ccpo",
    JWT_AUDIENCE: "ccpo-ui",
    JWT_PUBLIC_KEY_PATH: "/run/config/public.pem",
    JWT_PRIVATE_KEY_PATH: "/run/config/private.pem",
    AUTH_LIMITER_MODE: "redis",
    AUTH_COOKIE_SECURE: "true",
  };
  expect(parseAuth(complete, "production")).toMatchObject({
    limiterMode: "redis",
    cookieSecure: true,
  });
  for (const key of ["JWT_PUBLIC_KEY_PATH", "JWT_PRIVATE_KEY_PATH"] as const) {
    expect(() => parseAuth({ ...complete, [key]: "" }, "production")).toThrow();
  }
});

it("sets and clears exact production host cookies with fixed security attributes", () => {
  const setCookie = vi.fn();
  const clearCookie = vi.fn();
  const reply = { setCookie, clearCookie } as unknown as FastifyReply;
  const policy = createSessionCookiePolicy({
    secure: true,
    publicBaseUrl: "https://example.test",
    accessLifetimeSeconds: 900,
  });
  const issue: SessionIssue = {
    accessToken: "runtime-access-value",
    refreshToken: "runtime-refresh-value",
    csrfToken: "runtime-csrf-value",
    session: {
      user_id: "11111111-1111-4111-8111-111111111111",
      tenant_id: "22222222-2222-4222-8222-222222222222",
      role: "finops_analyst",
      access_expires_at: "2033-05-18T03:48:20.000000Z",
      refresh_idle_expires_at: "2033-05-25T03:33:20.000000Z",
      refresh_absolute_expires_at: "2033-06-17T03:33:20.000000Z",
    },
  };
  setSessionCookies(reply, policy, issue, 2_000_000_000_000);
  clearSessionCookies(reply, policy);
  const sets = setCookie.mock.calls.map(([name, _value, options]) => ({ name, options }));
  const clears = clearCookie.mock.calls.map(([name, options]) => ({ name, options }));

  expect(sets.map(({ name }) => name)).toEqual([
    "__Host-ccpo_access",
    "__Host-ccpo_refresh",
    "__Host-ccpo_csrf",
  ]);
  expect(
    sets.every(
      ({ options }) =>
        options.secure === true &&
        options.sameSite === "strict" &&
        options.path === "/" &&
        options.domain === undefined &&
        options.maxAge >= 0,
    ),
  ).toBe(true);
  expect(sets.map(({ options }) => options.httpOnly)).toEqual([true, true, false]);
  expect(clears.map(({ name }) => name)).toEqual(sets.map(({ name }) => name));
  expect(
    clears.every(
      ({ options }) =>
        options.secure === true &&
        options.sameSite === "strict" &&
        options.path === "/" &&
        options.domain === undefined,
    ),
  ).toBe(true);
});

it("allows unprefixed non-secure cookies only for loopback development or test", () => {
  expect(
    createSessionCookiePolicy({
      secure: false,
      publicBaseUrl: "http://127.0.0.1:8080",
      accessLifetimeSeconds: 900,
    }),
  ).toMatchObject({
    accessName: "ccpo_access",
    refreshName: "ccpo_refresh",
    csrfName: "ccpo_csrf",
    secure: false,
  });
  expect(() =>
    parseEnvironment({ PUBLIC_BASE_URL: "http://example.test", AUTH_COOKIE_SECURE: "false" }),
  ).toThrow(/loopback/u);
  expect(
    createSessionCookiePolicy({
      secure: true,
      publicBaseUrl: "https://example.test",
      accessLifetimeSeconds: 900,
    }),
  ).toMatchObject({
    accessName: "__Host-ccpo_access",
    refreshName: "__Host-ccpo_refresh",
    csrfName: "__Host-ccpo_csrf",
    secure: true,
  });
});
