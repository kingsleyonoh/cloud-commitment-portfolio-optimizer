import type { AppConfig } from "../../core/config/env.js";
import type { DbPoolResource } from "../../core/shared/db.js";
import type { Logger } from "../../core/shared/logger.js";
import { bootstrap } from "../../apps/api/bootstrap.js";
import type { AuthenticationRuntime } from "../../apps/api/plugins/auth.js";
import { describe, expect, it } from "vitest";

function config(nodeEnv: "test" | "production", port = 0): Readonly<AppConfig> {
  return {
    runtime: { nodeEnv, port },
    database: { pool: { connectionTimeoutMillis: 2000 } },
    storage: { objectStoragePath: ".data/objects" },
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

function authentication(): AuthenticationRuntime {
  return {
    repository: {
      findApiKeyIdentity: async () => null,
      findUserIdentity: async () => null,
    },
    jwtPublicKey: null,
    jwtPolicy: {
      issuer: "ccpo",
      audience: "ccpo-ui",
      maxLifetimeSeconds: 900,
      clockToleranceSeconds: 30,
    },
  };
}

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

describe("running API lifecycle", () => {
  it("listens on an OS-assigned loopback port and closes idempotently", async () => {
    const runtime = await bootstrap({
      getConfig: async () => config("test"),
      getLogger: async () => silentLogger(),
      getDatabase: async () => database(),
    });

    try {
      expect(runtime.host).toBe("127.0.0.1");
      expect(runtime.port).toBeGreaterThan(0);
      const response = await fetch(`http://${runtime.host}:${runtime.port}/`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("<h1>Page not found</h1>");
    } finally {
      const first = runtime.close();
      const second = runtime.close();
      expect(second).toBe(first);
      await first;
    }
  });

  it("selects the container-reachable host only for production", async () => {
    const listenCalls: Array<{ host: string; port: number }> = [];
    const close = async () => undefined;
    const app = {
      listen: async (options: { host: string; port: number }) => {
        listenCalls.push(options);
        return "http://0.0.0.0:8080";
      },
      close,
      server: { address: () => ({ address: "0.0.0.0", family: "IPv4", port: 8080 }) },
    };

    const runtime = await bootstrap({
      getConfig: async () => config("production", 8080),
      getLogger: async () => silentLogger(),
      getDatabase: async () => database(),
      createAuthentication: async () => authentication(),
      buildApplication: () => app,
      createCloser: () => close,
    });
    await runtime.close();

    expect(listenCalls).toEqual([{ host: "0.0.0.0", port: 8080 }]);
  });
});
