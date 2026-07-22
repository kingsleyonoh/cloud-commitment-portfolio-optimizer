import { describe, expect, it } from "vitest";

import {
  createLocalProtectedUsersLimiter,
  protectedUsersBucketDigest,
} from "../../core/tenant/protected-users-limiter.js";
import { createUserRequestContext } from "../../core/tenant/request-context.js";

function context(actorUserId = "22222222-2222-4222-8222-222222222222") {
  return createUserRequestContext({
    tenantId: "11111111-1111-4111-8111-111111111111",
    actorUserId,
    role: "tenant_admin",
    requestId: "request-safe",
  });
}

describe("protected users rolling limiter", () => {
  it("uses only a nonreversible context+route+method digest", () => {
    const key = protectedUsersBucketDigest(context(), "GET", "/api/users");

    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect(key).not.toContain(context().tenantId);
    expect(key).not.toContain(context().actorUserId);
    expect(key).not.toBe(protectedUsersBucketDigest(context(), "POST", "/api/users"));
    expect(key).not.toBe(
      protectedUsersBucketDigest(
        context("33333333-3333-4333-8333-333333333333"),
        "GET",
        "/api/users",
      ),
    );
  });

  it("admits 60 GETs and denies the 61st without extending the window", async () => {
    let now = 1_000;
    const limiter = createLocalProtectedUsersLimiter({ clock: () => now });
    for (let count = 0; count < 60; count += 1) {
      await expect(limiter.admit(context(), "GET", "/api/users")).resolves.toEqual({
        allowed: true,
      });
    }
    await expect(limiter.admit(context(), "GET", "/api/users")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    now += 30_001;
    await expect(limiter.admit(context(), "GET", "/api/users")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it.each([
    ["POST", "/api/users"],
    ["PATCH", "/api/users/{id}"],
  ] as const)("admits 30 %s requests and denies the 31st", async (method, route) => {
    const limiter = createLocalProtectedUsersLimiter({ clock: () => 1_000 });
    for (let count = 0; count < 30; count += 1) {
      expect((await limiter.admit(context(), method, route)).allowed).toBe(true);
    }
    await expect(limiter.admit(context(), method, route)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("returns the ceiling remaining delay and admits at the exact window boundary", async () => {
    let now = 1_000;
    const limiter = createLocalProtectedUsersLimiter({ clock: () => now });
    const admitPassword = () =>
      limiter.admit(
        context(),
        "PUT",
        "/api/users/{id}/credentials/password",
        "44444444-4444-4444-8444-444444444444",
      );
    for (let count = 0; count < 5; count += 1) {
      await expect(admitPassword()).resolves.toEqual({ allowed: true });
    }
    now += 1;
    await expect(admitPassword()).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    now += 1_000;
    await expect(admitPassword()).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 59,
    });
    now = 61_000;
    await expect(admitPassword()).resolves.toEqual({ allowed: true });
  });

  it("admits exactly five selected-key rotations and denies the sixth", async () => {
    const limiter = createLocalProtectedUsersLimiter({ clock: () => 1_000 });
    for (let count = 0; count < 5; count += 1) {
      await expect(limiter.admit(context(), "POST", "/api/api-keys/rotate")).resolves.toEqual({
        allowed: true,
      });
    }
    await expect(limiter.admit(context(), "POST", "/api/api-keys/rotate")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });
});
