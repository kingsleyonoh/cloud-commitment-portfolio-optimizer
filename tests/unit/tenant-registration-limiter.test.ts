import { describe, expect, it } from "vitest";
import {
  canonicalizeClientIp,
  createLocalRegistrationLimiter,
} from "../../core/tenant/registration-limiter.js";

describe("process-local registration limiter", () => {
  it("canonicalizes IPv4, mapped IPv6, and RFC 5952 IPv6", () => {
    expect(canonicalizeClientIp("192.0.2.7")).toBe("192.0.2.7");
    expect(canonicalizeClientIp("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(canonicalizeClientIp("2001:0db8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(() => canonicalizeClientIp("not-an-ip")).toThrow();
  });

  it("admits five rolling-window attempts and denies without extending the window", async () => {
    let now = 10_000;
    const limiter = createLocalRegistrationLimiter({ clock: () => now });

    for (let count = 0; count < 5; count += 1) {
      await expect(limiter.admit("192.0.2.1")).resolves.toEqual({ allowed: true });
    }
    await expect(limiter.admit("192.0.2.1")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    now += 30_001;
    await expect(limiter.admit("192.0.2.1")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    now += 29_999;
    await expect(limiter.admit("192.0.2.1")).resolves.toEqual({ allowed: true });
  });

  it("keeps canonical client buckets independent", async () => {
    const limiter = createLocalRegistrationLimiter({ clock: () => 1_000 });
    for (let count = 0; count < 5; count += 1) await limiter.admit("192.0.2.1");

    await expect(limiter.admit("192.0.2.2")).resolves.toEqual({ allowed: true });
    await expect(limiter.admit("::ffff:192.0.2.1")).resolves.toMatchObject({ allowed: false });
  });
});
