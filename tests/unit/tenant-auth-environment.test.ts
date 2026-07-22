import { expect, it } from "vitest";

import { EnvironmentValidationError } from "../../core/config/env-schema.js";
import { parseAuth } from "../../core/config/env-runtime.js";

it("provides strict bounded development session defaults with issuance disabled until configured", () => {
  const auth = parseAuth({ NODE_ENV: "development" }, "development");

  expect(auth).toEqual({
    jwtIssuer: "ccpo",
    jwtAudience: "ccpo-ui",
    jwtPrivateKeyPath: "",
    jwtPublicKeyPath: "",
    jwtAccessTokenMaxLifetimeSeconds: 900,
    jwtClockToleranceSeconds: 30,
    argonConcurrency: 2,
    argonQueueLimit: 32,
    limiterMode: "local",
    trustedProxyCidrs: [],
    cookieSecure: false,
  });
});

it("requires issuer, audience, and a public-key path in production", () => {
  const complete = {
    JWT_ISSUER: "ccpo",
    JWT_AUDIENCE: "ccpo-ui",
    JWT_PUBLIC_KEY_PATH: "/run/config/jwt-public.pem",
    JWT_PRIVATE_KEY_PATH: "/run/config/jwt-private.pem",
    AUTH_LIMITER_MODE: "redis",
    AUTH_COOKIE_SECURE: "true",
  };
  expect(parseAuth(complete, "production").jwtPublicKeyPath).toBe("/run/config/jwt-public.pem");

  for (const missing of [
    "JWT_ISSUER",
    "JWT_AUDIENCE",
    "JWT_PUBLIC_KEY_PATH",
    "JWT_PRIVATE_KEY_PATH",
  ]) {
    const source = { ...complete, [missing]: "" };
    expect(() => parseAuth(source, "production")).toThrowError(
      expect.objectContaining({ code: "ENV_VALIDATION_ERROR" }),
    );
  }
});

it.each([
  ["JWT_ACCESS_TOKEN_MAX_LIFETIME_SECONDS", "0"],
  ["JWT_ACCESS_TOKEN_MAX_LIFETIME_SECONDS", "901"],
  ["JWT_ACCESS_TOKEN_MAX_LIFETIME_SECONDS", "1.5"],
  ["JWT_CLOCK_TOLERANCE_SECONDS", "-1"],
  ["JWT_CLOCK_TOLERANCE_SECONDS", "31"],
  ["JWT_CLOCK_TOLERANCE_SECONDS", "1.5"],
])("rejects out-of-contract %s=%s", (key, value) => {
  expect(() => parseAuth({ [key]: value }, "development")).toThrow(EnvironmentValidationError);
});
