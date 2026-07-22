import type { Logger } from "../../core/shared/logger.js";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../../apps/api/app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
const healthOptions = {
  databaseProbe: async () => ({ ready: false }),
  databaseTimeoutMs: 25,
};

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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

it("returns accessible branded HTML 404s with request IDs and safe headers", async () => {
  const app = buildApp({
    logger: silentLogger(),
    genReqId: () => "request-root",
    ...healthOptions,
  });
  apps.push(app);

  const response = await app.inject({ method: "GET", url: "/" });

  expect(response.statusCode).toBe(404);
  expect(response.headers["content-type"]).toContain("text/html");
  expect(response.headers["x-request-id"]).toBe("request-root");
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
  expect(response.body).toContain("<main");
  expect(response.body).toContain("<h1>Page not found</h1>");
  expect(response.body).toContain("Cloud Commitment Portfolio Optimizer");
  expect(response.body).not.toMatch(/<script\b/iu);
  expect(response.body).not.toMatch(/(?:src|href)=["']https?:/iu);
  expect(app.server.listening).toBe(false);
});

it("returns the canonical JSON envelope for unknown API routes", async () => {
  const app = buildApp({ logger: silentLogger(), genReqId: () => "request-api", ...healthOptions });
  apps.push(app);

  const response = await app.inject({ method: "GET", url: "/api/missing" });

  expect(response.statusCode).toBe(404);
  expect(response.headers["content-type"]).toContain("application/json");
  expect(response.json()).toEqual({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
      details: [{ reference: "request-api" }],
    },
  });
});

it("normalizes unknown HTML and API failures without leaking raw error content", async () => {
  const app = buildApp({
    logger: silentLogger(),
    genReqId: () => "request-error",
    ...healthOptions,
  });
  apps.push(app);
  app.get("/explode", async () => {
    throw new Error("database-password at C:\\private\\server.ts");
  });
  app.get("/api/explode", async () => {
    throw new Error("Bearer top-secret-token");
  });

  const [html, json] = await Promise.all([
    app.inject({ method: "GET", url: "/explode" }),
    app.inject({ method: "GET", url: "/api/explode" }),
  ]);

  expect(html.statusCode).toBe(500);
  expect(html.body).toContain("<h1>Something went wrong</h1>");
  expect(html.body).not.toContain("database-password");
  expect(html.body).not.toContain("server.ts");
  expect(json.statusCode).toBe(500);
  expect(json.json()).toEqual({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: [{ reference: "request-error" }],
    },
  });
  expect(json.body).not.toContain("top-secret-token");
});
