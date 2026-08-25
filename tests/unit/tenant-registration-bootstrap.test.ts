import type { AppConfig } from "../../core/config/env.js";
import type { DbPoolResource } from "../../core/shared/db.js";
import type { Logger } from "../../core/shared/logger.js";
import type { RegistrationLimiter } from "../../core/tenant/registration-limiter.js";
import type { BuildAppOptions } from "../../apps/api/app.js";
import { bootstrap } from "../../apps/api/bootstrap.js";
import type { ResourceName } from "../../apps/api/resources.js";
import { expect, it, vi } from "vitest";

function config(enabled: boolean): Readonly<AppConfig> {
  return {
    runtime: { nodeEnv: "test", port: 0 },
    database: { pool: { connectionTimeoutMillis: 500 } },
    queue: { url: "redis://127.0.0.1:6379" },
    storage: { objectStoragePath: ".data/objects" },
    tenant: {
      selfRegistrationEnabled: enabled,
      registrationLimiterMode: "redis",
      registrationTrustedProxyCidrs: ["127.0.0.1"],
      apiKeyPrefix: "ccpo",
    },
    auth: {
      jwtIssuer: "ccpo",
      jwtAudience: "ccpo-ui",
      jwtPublicKeyPath: "",
      jwtAccessTokenMaxLifetimeSeconds: 900,
      jwtClockToleranceSeconds: 30,
    },
  } as unknown as Readonly<AppConfig>;
}

function database(): DbPoolResource {
  return {
    pool: {} as DbPoolResource["pool"],
    health: async () => ({ ready: true }),
    close: async () => undefined,
  };
}

function logger(): Logger {
  const result: Logger = {
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
    child: () => result,
    flush: async () => undefined,
    close: async () => undefined,
  };
  return result;
}

function objectStore() {
  return {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => Buffer.from("")),
    delete: vi.fn(async () => undefined),
    health: vi.fn(async () => ({ ready: true })),
    close: vi.fn(async () => undefined),
  };
}

function application() {
  return {
    listen: vi.fn(async () => "http://127.0.0.1:4100"),
    close: vi.fn(async () => undefined),
    server: { address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4100 }) },
  };
}

it("does not initialize a registration limiter while the route is disabled", async () => {
  const createRegistrationLimiter = vi.fn();
  const app = application();
  const runtime = await bootstrap({
    getConfig: async () => config(false),
    getLogger: async () => logger(),
    getDatabase: async () => database(),
    getObjectStore: async () => objectStore(),
    createRegistrationLimiter,
    buildApplication: () => app,
    createCloser: () => async () => undefined,
  });

  expect(createRegistrationLimiter).not.toHaveBeenCalled();
  await runtime.close();
});

it("fails startup and closes acquired resources when shared limiter health fails", async () => {
  const close = vi.fn(async () => undefined);
  let initialized: ReadonlySet<ResourceName> | undefined;
  await expect(
    bootstrap({
      getConfig: async () => config(true),
      getLogger: async () => logger(),
      getDatabase: async () => database(),
      createRegistrationLimiter: async () => Promise.reject(new Error("dependency unavailable")),
      buildApplication: () => application(),
      createCloser: (_app, acquired) => {
        initialized = new Set(acquired);
        return close;
      },
    }),
  ).rejects.toThrow("dependency unavailable");

  expect(initialized).toEqual(new Set<ResourceName>(["environment", "logger", "database"]));
  expect(close).toHaveBeenCalledTimes(1);
});

it("wires a healthy limiter, service, and explicit proxy allowlist", async () => {
  const limiter: RegistrationLimiter = {
    mode: "redis",
    admit: async () => ({ allowed: true }),
  };
  const captured: BuildAppOptions[] = [];
  const app = application();
  const runtime = await bootstrap({
    getConfig: async () => config(true),
    getLogger: async () => logger(),
    getDatabase: async () => database(),
    createRegistrationLimiter: async () => limiter,
    getObjectStore: async () => objectStore(),
    buildApplication: (options) => {
      captured.push(options);
      return app;
    },
    createCloser: () => async () => undefined,
  });

  expect(captured[0]?.tenantRegistration?.limiter).toBe(limiter);
  expect(captured[0]?.registrationTrustedProxyCidrs).toEqual(["127.0.0.1"]);
  await runtime.close();
});
