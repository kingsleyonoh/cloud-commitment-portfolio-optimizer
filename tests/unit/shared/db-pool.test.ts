import { describe, expect, it, vi } from "vitest";
import {
  createAppDbPoolResource,
  createDbPoolCache,
  toPgPoolConfig,
  type DbPoolResource,
} from "../../../core/shared/db.js";

function registerPoolBoundaryTest(): void {
  it("applies typed application pool boundaries to pg.Pool", async () => {
    const database = {
      url: "postgresql://user@localhost:5432/ccpo",
      localPort: 5432,
      pool: { max: 7, idleTimeoutMillis: 12345, connectionTimeoutMillis: 2345 },
    };

    expect(toPgPoolConfig(database)).toEqual({
      connectionString: database.url,
      max: 7,
      idleTimeoutMillis: 12345,
      connectionTimeoutMillis: 2345,
    });

    const resource = createAppDbPoolResource(database);
    const applied = resource.pool.options;
    expect(applied.max).toBe(7);
    expect(applied.idleTimeoutMillis).toBe(12345);
    expect(applied.connectionTimeoutMillis).toBe(2345);
    await resource.close();
  });
}

function registerPoolCoalescingTest(): void {
  it("coalesces concurrent pool acquisition and closes idempotently", async () => {
    const resource: DbPoolResource = {
      pool: {} as DbPoolResource["pool"],
      health: vi.fn(async () => ({ ready: true })),
      close: vi.fn(async () => undefined),
    };
    const factory = vi.fn(async () => resource);
    const cache = createDbPoolCache(factory);

    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    await Promise.all([cache.close(), cache.close()]);
    expect(resource.close).toHaveBeenCalledTimes(1);
  });
}

function registerPoolFailureTest(): void {
  it("does not cache factory failures or expose connection configuration", async () => {
    const secretUrl = "postgresql://user:placeholder@localhost:5432/ccpo";
    const safeFailure = new Error("Database pool initialization failed.");
    const resource = {
      pool: {} as DbPoolResource["pool"],
      health: vi.fn(async () => ({ ready: true })),
      close: vi.fn(async () => undefined),
    };
    const factory = vi.fn().mockRejectedValueOnce(safeFailure).mockResolvedValueOnce(resource);
    const cache = createDbPoolCache(factory);

    await expect(cache.get()).rejects.toThrow("Database pool initialization failed.");
    await expect(cache.get()).resolves.toBe(resource);
    expect(String(safeFailure)).not.toContain(secretUrl);
    expect(factory).toHaveBeenCalledTimes(2);
    await cache.close();
  });
}

describe("db pool cache contract", () => {
  registerPoolBoundaryTest();
  registerPoolCoalescingTest();
  registerPoolFailureTest();
});
