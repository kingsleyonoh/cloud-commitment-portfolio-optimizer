import type { Logger } from "../../core/shared/logger.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];

function silentLogger(): Logger {
  const logger: Logger = {
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
    child: () => logger,
    flush: async () => undefined,
    close: async () => undefined,
  };
  return logger;
}

function createApp(databaseProbe = vi.fn(async () => ({ ready: true }))) {
  const app = buildApp({
    logger: silentLogger(),
    genReqId: () => "generated-health-id",
    databaseProbe,
    databaseTimeoutMs: 25,
  });
  apps.push(app);
  return { app, databaseProbe };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("health routes", () => {
  it("returns exact dependency-free liveness with generated identity and no-store", async () => {
    const { app, databaseProbe } = createApp(
      vi.fn(async () => {
        throw new Error("must not run");
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "caller-controlled-id" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(Object.keys(response.json())).toEqual(["status"]);
    expect(response.headers["content-type"]).toMatch(/^application\/json/u);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("generated-health-id");
    expect(response.body).not.toContain("caller-controlled-id");
    expect(databaseProbe).not.toHaveBeenCalled();
  });

  it("returns exact database success through the injected probe", async () => {
    const { app, databaseProbe } = createApp();

    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(Object.keys(response.json())).toEqual(["status"]);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("generated-health-id");
    expect(databaseProbe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-ready", async () => ({ ready: false, code: "DB_PRIVATE_CODE" })],
    ["rejection", async () => Promise.reject(new Error("postgres://private-host/secret-db"))],
  ])("returns exact minimal 503 for %s probes without details", async (_name, probe) => {
    const { app } = createApp(vi.fn(probe));

    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    expect(Object.keys(response.json())).toEqual(["status"]);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toMatch(/private|postgres|secret|code/iu);
  });

  it("bounds a never-settling database probe", async () => {
    const { app, databaseProbe } = createApp(vi.fn(() => new Promise(() => undefined)));
    const startedAt = performance.now();

    const response = await app.inject({ method: "GET", url: "/health/db" });
    const elapsedMs = performance.now() - startedAt;

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    expect(elapsedMs).toBeGreaterThanOrEqual(15);
    expect(elapsedMs).toBeLessThan(250);
    expect(databaseProbe).toHaveBeenCalledTimes(1);
  });
});
