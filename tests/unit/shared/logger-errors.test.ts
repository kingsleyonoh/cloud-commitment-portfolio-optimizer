import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AppError, normalizeError, toErrorEnvelope } from "../../../core/shared/errors.js";
import { createLogger, createLoggerCache, type LogSink } from "../../../core/shared/logger.js";

describe("safe errors", () => {
  it("preserves stable known error fields in the exact PRD envelope", () => {
    const error = new AppError({
      code: "OBJECT_KEY_INVALID",
      message: "The object key is invalid.",
      statusCode: 400,
      details: [{ field: "key" }],
    });

    expect(normalizeError(error)).toBe(error);
    expect(toErrorEnvelope(error, "request-1")).toEqual({
      error: {
        code: "OBJECT_KEY_INVALID",
        message: "The object key is invalid.",
        details: [{ field: "key" }],
      },
    });
    expect(error.statusCode).toBe(400);
  });

  it("normalizes unknown values to a stable correlation-safe fallback", () => {
    const secret = new Error("failed at postgresql://user:placeholder@db.internal/ccpo");
    secret.stack = "secret stack do-not-print";
    Object.assign(secret, { cause: { token: "do-not-print" } });

    const normalized = normalizeError(secret, { correlationId: "request-2" });
    const envelope = toErrorEnvelope(secret, "request-2");
    expect(normalized).toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500 });
    expect(envelope).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        details: [{ reference: "request-2" }],
      },
    });
    expect(JSON.stringify(envelope)).not.toMatch(/do-not-print|stack|cause|postgresql/iu);
  });
});

it("emits deterministic context and recursively redacts sensitive values", async () => {
  const records: string[] = [];
  const sink: LogSink = {
    write: vi.fn(async (record) => {
      records.push(record);
    }),
    flush: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const logger = createLogger({
    sink,
    clock: () => new Date("2026-07-14T12:00:00.000Z"),
    context: { module: "optimizer", tenantId: "tenant-a" },
  }).child({ requestId: "request-3" });

  await logger.error("adapter.failed", {
    authorization: "Bearer do-not-print",
    nested: { password: "do-not-print", safe: "visible" },
    databaseUrl: "postgresql://user:placeholder@db.internal/ccpo",
    cookie: "session=do-not-print",
    setCookie: "session=do-not-print",
    csrfDigest: "do-not-print",
    email: "do-not-print",
    clientIp: "do-not-print",
    requestBody: "do-not-print",
  });

  const record = JSON.parse(records[0]!);
  expect(record).toMatchObject({
    timestamp: "2026-07-14T12:00:00.000Z",
    level: "error",
    event: "adapter.failed",
    module: "optimizer",
    tenantId: "tenant-a",
    requestId: "request-3",
    nested: { password: "[REDACTED]", safe: "visible" },
    authorization: "[REDACTED]",
    databaseUrl: "[REDACTED]",
    cookie: "[REDACTED]",
    setCookie: "[REDACTED]",
    csrfDigest: "[REDACTED]",
    email: "[REDACTED]",
    clientIp: "[REDACTED]",
    requestBody: "[REDACTED]",
  });
  expect(records[0]).not.toContain("do-not-print");
  await logger.close();
});

it("redacts event and string-field secrets while preserving stable event semantics", async () => {
  const records: string[] = [];
  const logger = createLogger({
    sink: {
      write: (record) => {
        records.push(record);
      },
    },
  });
  const events = [
    ["request.failed Bearer do-not-print", "request.failed [REDACTED]"],
    ["auth.failed password=do-not-print", "auth.failed password=[REDACTED]"],
    ["adapter.failed token:do-not-print", "adapter.failed token:[REDACTED]"],
    ["config.failed secret='do-not-print'", "config.failed secret=[REDACTED]"],
    ["db.failed postgresql://user:do-not-print@db.test/ccpo", "db.failed [REDACTED_URL]"],
  ] as const;

  for (const [event] of events) {
    await logger.error(event, { detail: "credential password=do-not-print" });
  }
  expect(records.map((record) => JSON.parse(record).event)).toEqual(
    events.map(([, expected]) => expected),
  );
  expect(
    records.every((record) => JSON.parse(record).detail === "credential password=[REDACTED]"),
  ).toBe(true);
  expect(records.join("\n")).not.toContain("do-not-print");
  await logger.close();
});

it("redacts standalone versioned credentials and lowercase SHA-256 digests", async () => {
  const records: string[] = [];
  const logger = createLogger({
    sink: {
      write: (record) => {
        records.push(record);
      },
    },
  });
  const plaintext = `ccpo_live_v1_${randomBytes(32).toString("base64url")}`;
  const digest = createHash("sha256").update(plaintext, "utf8").digest("hex");

  await logger.error(`setup.failed ${plaintext}`, { detail: `stored ${digest}` });
  const serialized = records[0] ?? "";
  const plaintextAbsent = !serialized.includes(plaintext);
  const digestAbsent = !serialized.includes(digest);

  expect(plaintextAbsent).toBe(true);
  expect(digestAbsent).toBe(true);
  await logger.close();
});

it("normalizes Error attributes without exposing message, stack, cause, or URLs", async () => {
  const records: string[] = [];
  const logger = createLogger({
    sink: {
      write: (record) => {
        records.push(record);
      },
    },
    clock: () => new Date(0),
  });
  const error = new Error("request failed https://user:do-not-print@example.test/path");
  error.stack = "stack do-not-print";

  await logger.error("request.failed", { error });
  expect(JSON.parse(records[0]!).error).toEqual({
    name: "Error",
    message: "[REDACTED_ERROR]",
  });
  expect(records[0]).not.toContain("do-not-print");
  await logger.close();
});

it("propagates sink flush/close failures and cache close remains resettable", async () => {
  const failingSink: LogSink = {
    write: vi.fn(async () => undefined),
    flush: vi.fn(async () => {
      throw new Error("flush failed");
    }),
  };
  const logger = createLogger({ sink: failingSink });
  await expect(logger.flush()).rejects.toThrow("flush failed");

  const nextLogger = createLogger({ sink: { write: vi.fn() } });
  const factory = vi.fn().mockResolvedValueOnce(logger).mockResolvedValueOnce(nextLogger);
  const cache = createLoggerCache(factory);
  await cache.get();
  await expect(cache.close()).rejects.toThrow("flush failed");
  await expect(cache.get()).resolves.toBe(nextLogger);
  await cache.close();
});
