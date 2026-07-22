import type { AppConfig } from "../../core/config/env.js";
import type { DbPoolResource } from "../../core/shared/db.js";
import type { Logger } from "../../core/shared/logger.js";
import type { ArgonExecutor } from "../../core/tenant/argon-executor.js";
import type { BuildAppOptions } from "../../apps/api/app.js";
import { bootstrap } from "../../apps/api/bootstrap.js";
import type { AuthenticationRuntime } from "../../apps/api/plugins/auth.js";
import type { ResourceName } from "../../apps/api/resources.js";
import { expect, it, vi } from "vitest";

const config = {
  runtime: { nodeEnv: "test", port: 0 },
  database: { pool: { connectionTimeoutMillis: 2000 } },
  auth: {
    jwtIssuer: "ccpo",
    jwtAudience: "ccpo-ui",
    jwtPublicKeyPath: "",
    jwtAccessTokenMaxLifetimeSeconds: 900,
    jwtClockToleranceSeconds: 30,
  },
} as unknown as Readonly<AppConfig>;

function fakeDatabase(): DbPoolResource {
  return {
    pool: {} as DbPoolResource["pool"],
    health: vi.fn(async () => ({ ready: true })),
    close: vi.fn(async () => undefined),
  };
}

function fakeLogger(): Logger {
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

it("closes the constructed app and acquired database after listen failure", async () => {
  const close = vi.fn(async () => undefined);
  const listenFailure = new Error("listen failed");
  const app = {
    listen: vi.fn(async () => Promise.reject(listenFailure)),
    close: vi.fn(async () => undefined),
    server: { address: () => null },
  };
  let initialized: ReadonlySet<ResourceName> | undefined;

  await expect(
    bootstrap({
      getConfig: async () => config,
      getLogger: async () => fakeLogger(),
      getDatabase: async () => fakeDatabase(),
      buildApplication: () => app,
      createCloser: (_app, acquired) => {
        initialized = new Set(acquired);
        return close;
      },
    }),
  ).rejects.toBe(listenFailure);

  expect(initialized).toEqual(
    new Set<ResourceName>(["environment", "logger", "database", "usersLimiter"]),
  );
  expect(close).toHaveBeenCalledTimes(1);
});

it("closes session resources when application construction fails before hook ownership", async () => {
  const failure = new Error("construction failed");
  const closeRuntime = vi.fn(async () => undefined);
  const closeLimiter = vi.fn(async () => undefined);
  const closeArgon = vi.fn();
  const authentication = {
    sessions: {
      limiter: { close: closeLimiter },
      argonExecutor: { close: closeArgon },
    },
  } as unknown as AuthenticationRuntime;

  await expect(
    bootstrap({
      getConfig: async () => config,
      getLogger: async () => fakeLogger(),
      getDatabase: async () => fakeDatabase(),
      createAuthentication: async () => authentication,
      buildApplication: () => {
        throw failure;
      },
      createCloser: () => closeRuntime,
    }),
  ).rejects.toBe(failure);

  expect(closeArgon).toHaveBeenCalledTimes(1);
  expect(closeLimiter).toHaveBeenCalledTimes(1);
  expect(closeRuntime).toHaveBeenCalledTimes(1);
});

it("shares the session Argon executor with admin password work", async () => {
  const sharedExecutor = {
    run: vi.fn(async () => Promise.reject(new Error("bounded work unavailable"))),
    snapshot: () => ({ active: 0, queued: 0, closed: false }),
    close: vi.fn(),
  } as unknown as ArgonExecutor;
  const authentication = {
    sessions: {
      limiter: { close: async () => undefined },
      argonExecutor: sharedExecutor,
    },
  } as unknown as AuthenticationRuntime;
  const captured: BuildAppOptions[] = [];
  const app = {
    listen: vi.fn(async () => "http://127.0.0.1:4100"),
    close: vi.fn(async () => undefined),
    server: { address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4100 }) },
  };
  const runtime = await bootstrap({
    getConfig: async () => config,
    getLogger: async () => fakeLogger(),
    getDatabase: async () => fakeDatabase(),
    createAuthentication: async () => authentication,
    buildApplication: (options) => {
      captured.push(options);
      return app;
    },
    createCloser: () => async () => undefined,
  });

  const passwordService = captured[0]?.users?.passwordService;
  expect(passwordService).toBeDefined();
  await expect(
    passwordService!.setPassword(
      {
        tenantId: "11111111-1111-4111-8111-111111111111",
        actorType: "user",
        actorUserId: "22222222-2222-4222-8222-222222222222",
        apiKeyId: null,
        role: "tenant_admin",
        requestId: "request-id",
      },
      "33333333-3333-4333-8333-333333333333",
      { password: "correct horse battery" },
    ),
  ).rejects.toMatchObject({ code: "AUTH_DEPENDENCY_UNAVAILABLE" });
  expect(sharedExecutor.run).toHaveBeenCalledTimes(1);
  expect(captured[0]!.users!.closePasswordExecutor).toBeUndefined();
  await runtime.close();
});

it("fails production startup before app construction when the public key is missing", async () => {
  const close = vi.fn(async () => undefined);
  const buildApplication = vi.fn(() => {
    throw new Error("application must not be constructed");
  });
  let initialized: ReadonlySet<ResourceName> | undefined;

  await expect(
    bootstrap({
      getConfig: async () =>
        ({
          ...config,
          runtime: { nodeEnv: "production", port: 8080 },
        }) as Readonly<AppConfig>,
      getLogger: async () => fakeLogger(),
      getDatabase: async () => fakeDatabase(),
      buildApplication,
      createCloser: (_app, acquired) => {
        initialized = new Set(acquired);
        return close;
      },
    }),
  ).rejects.toMatchObject({ code: "JWT_PUBLIC_KEY_INVALID" });

  expect(buildApplication).not.toHaveBeenCalled();
  expect(initialized).toEqual(
    new Set<ResourceName>(["environment", "logger", "database", "usersLimiter"]),
  );
  expect(close).toHaveBeenCalledTimes(1);
});

it("closes environment state when logger acquisition fails", async () => {
  const close = vi.fn(async () => undefined);
  let initialized: ReadonlySet<ResourceName> | undefined;

  await expect(
    bootstrap({
      getConfig: async () => config,
      getLogger: async () => Promise.reject(new Error("logger unavailable")),
      getDatabase: async () => fakeDatabase(),
      createCloser: (_app, acquired) => {
        initialized = new Set(acquired);
        return close;
      },
    }),
  ).rejects.toThrow("logger unavailable");

  expect(initialized).toEqual(new Set<ResourceName>(["environment"]));
  expect(close).toHaveBeenCalledTimes(1);
});

it("injects the single acquired pool health method and clamps timeout to five seconds", async () => {
  const database = fakeDatabase();
  const app = {
    listen: vi.fn(async () => "http://127.0.0.1:4100"),
    close: vi.fn(async () => undefined),
    server: { address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4100 }) },
  };
  const captured: BuildAppOptions[] = [];
  const buildApplication = vi.fn((options: BuildAppOptions) => {
    captured.push(options);
    return app;
  });

  const runtime = await bootstrap({
    getConfig: async () =>
      ({
        ...config,
        database: { pool: { connectionTimeoutMillis: 9000 } },
      }) as Readonly<AppConfig>,
    getLogger: async () => fakeLogger(),
    getDatabase: async () => database,
    buildApplication,
    createCloser: () => async () => undefined,
  });

  const options = captured[0];
  await expect(options?.databaseProbe()).resolves.toEqual({ ready: true });
  expect(options?.databaseTimeoutMs).toBe(5000);
  expect(database.health).toHaveBeenCalledTimes(1);
  await runtime.close();
});
