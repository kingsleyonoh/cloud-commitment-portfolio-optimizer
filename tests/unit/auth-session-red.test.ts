import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import { parseAuth } from "../../core/config/env-runtime.js";

it("parses the issuance, cookie, limiter, and immediate-proxy session contract", () => {
  expect(
    parseAuth(
      {
        JWT_PRIVATE_KEY_PATH: "/run/config/jwt-private.pem",
        AUTH_LIMITER_MODE: "redis",
        AUTH_TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
        AUTH_COOKIE_SECURE: "true",
      },
      "development",
    ),
  ).toMatchObject({
    jwtPrivateKeyPath: "/run/config/jwt-private.pem",
    limiterMode: "redis",
    trustedProxyCidrs: ["127.0.0.1/32", "::1/128"],
    cookieSecure: true,
  });
});

it("fails production startup unless session cookies are secure and limiter is Redis", () => {
  const base = {
    JWT_ISSUER: "ccpo",
    JWT_AUDIENCE: "ccpo-ui",
    JWT_PUBLIC_KEY_PATH: "/run/config/jwt-public.pem",
    JWT_PRIVATE_KEY_PATH: "/run/config/jwt-private.pem",
  };

  expect(() =>
    parseAuth({ ...base, AUTH_LIMITER_MODE: "local", AUTH_COOKIE_SECURE: "true" }, "production"),
  ).toThrow();
  expect(() =>
    parseAuth({ ...base, AUTH_LIMITER_MODE: "redis", AUTH_COOKIE_SECURE: "false" }, "production"),
  ).toThrow();
});

it("pins the reviewed Fastify 5 cookie plugin without replacing JWT", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };

  expect(manifest.dependencies["@fastify/cookie"]).toBe("11.1.1");
  expect(manifest.dependencies["@fastify/jwt"]).toBe("10.2.0");
});

it("owns exact OpenAPI session routes and cookie schemes", async () => {
  const document = await readFile("openapi.yaml", "utf8");

  expect(document).toContain("/api/auth/login:");
  expect(document).toContain("/api/auth/refresh:");
  expect(document).toContain("/api/auth/logout:");
  expect(document).toContain("AccessCookie:");
  expect(document).toContain("RefreshCookie:");
  expect(document).toContain("CsrfCookie:");
  expect(document).not.toMatch(/example:\s*(?:eyJ|ccpo_|__Host-ccpo_)/u);
});
