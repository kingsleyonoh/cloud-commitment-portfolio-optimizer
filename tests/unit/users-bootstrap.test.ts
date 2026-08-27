import type { AppConfig } from "../../core/config/env.js";
import type { DbPoolResource } from "../../core/shared/db.js";
import type { Logger } from "../../core/shared/logger.js";
import type { ProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import type { BuildAppOptions } from "../../apps/api/app.js";
import { bootstrap } from "../../apps/api/bootstrap.js";
import type { ResourceName } from "../../apps/api/resources.js";
import { expect, it, vi } from "vitest";

function config(): Readonly<AppConfig> {
  return {
    runtime: { nodeEnv: "test", port: 0 },
    database: { pool: { connectionTimeoutMillis: 500 } },
    queue: { url: "redis://127.0.0.1:6379" },
    storage: { objectStoragePath: ".data/objects" },
    tenant: {
      selfRegistrationEnabled: false,
      registrationTrustedProxyCidrs: [],
      apiKeyPrefix: "ccpo",
    },
    users: {
      limiterMode: "redis",
      trustedEdgeAck: false,
      trustedProxyCidrs: ["127.0.0.1"],
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

it("fails startup and closes prior resources when the protected users limiter is unhealthy", async () => {
  const close = vi.fn(async () => undefined);
  let initialized: ReadonlySet<ResourceName> | undefined;
  await expect(
    bootstrap({
      getConfig: async () => config(),
      getLogger: async () => logger(),
      getDatabase: async () => database(),
      createUsersLimiter: async () => Promise.reject(new Error("limiter unavailable")),
      buildApplication: () => application(),
      createCloser: (_app, acquired) => {
        initialized = new Set(acquired);
        return close;
      },
    }),
  ).rejects.toThrow("limiter unavailable");

  expect(initialized).toEqual(new Set<ResourceName>(["environment", "logger", "database"]));
  expect(close).toHaveBeenCalledTimes(1);
});

it("wires one healthy limiter and users service without changing registration proxy trust", async () => {
  const limiter: ProtectedUsersLimiter = {
    mode: "redis",
    admit: async () => ({ allowed: true }),
  };
  const captured: BuildAppOptions[] = [];
  const app = application();
  const runtime = await bootstrap({
    getConfig: async () => config(),
    getLogger: async () => logger(),
    getDatabase: async () => database(),
    createUsersLimiter: async () => limiter,
    getObjectStore: async () => objectStore(),
    buildApplication: (options) => {
      captured.push(options);
      return app;
    },
    createCloser: () => async () => undefined,
  });

  expect(captured[0]?.users?.limiter).toBe(limiter);
  expect(captured[0]?.users?.service).toBeDefined();
  expect(captured[0]?.apiKeys?.limiter).toBe(limiter);
  expect(captured[0]?.apiKeys?.service).toBeDefined();
  expect(captured[0]?.apiKeyRotation?.limiter).toBe(limiter);
  expect(captured[0]?.apiKeyRotation?.service).toBeDefined();
  expect(captured[0]?.imports?.limiter).toBe(limiter);
  expect(captured[0]?.imports?.service).toBeDefined();
  expect(captured[0]?.registrationTrustedProxyCidrs).toEqual([]);
  await runtime.close();
});
