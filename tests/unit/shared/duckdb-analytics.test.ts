import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createDuckdbAnalyticsCache,
  createDuckdbAnalyticsManager,
  createUnavailableDuckdbAnalytics,
  type DuckdbEngine,
} from "../../../core/shared/duckdbAnalytics.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "ccpo-duckdb-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("is fail-closed and never reports ready without an engine", async () => {
  const manager = createUnavailableDuckdbAnalytics();

  await expect(manager.health()).resolves.toEqual({
    ready: false,
    code: "DUCKDB_ADAPTER_UNAVAILABLE",
  });
  await expect(manager.openSession()).rejects.toMatchObject({
    code: "DUCKDB_ADAPTER_UNAVAILABLE",
  });
  await manager.close();
});

it("owns per-session temporary workspaces and cleans them on session/manager close", async () => {
  const root = await tempRoot();
  const engines: DuckdbEngine[] = [];
  const engineFactory = vi.fn(async () => {
    const engine: DuckdbEngine = {
      execute: vi.fn(async () => undefined),
      async query<T extends Record<string, unknown>>() {
        return [{ probe: 1 }] as unknown as readonly T[];
      },
      close: vi.fn(async () => undefined),
    };
    engines.push(engine);
    return engine;
  });
  const manager = createDuckdbAnalyticsManager({ tempRoot: root, engineFactory });

  const first = await manager.openSession();
  const second = await manager.openSession();
  await expect(first.query<{ probe: number }>("SELECT probe")).resolves.toEqual([{ probe: 1 }]);
  await expect(access(first.workspacePath)).resolves.toBeUndefined();
  await first.close();
  await expect(access(first.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
  await manager.close();
  await expect(access(second.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(engines.every((engine) => vi.mocked(engine.close).mock.calls.length === 1)).toBe(true);
});

it("cleans a temporary workspace when engine initialization fails", async () => {
  const root = await tempRoot();
  const manager = createDuckdbAnalyticsManager({
    tempRoot: root,
    engineFactory: vi.fn(async () => {
      throw new Error("probe init failed");
    }),
  });

  await expect(manager.openSession()).rejects.toThrow("probe init failed");
  const { readdir } = await import("node:fs/promises");
  await expect(readdir(root)).resolves.toEqual([]);
  await manager.close();
});

it("caches an injected manager contract and closes it idempotently", async () => {
  const manager = createUnavailableDuckdbAnalytics();
  const close = vi.spyOn(manager, "close");
  const factory = vi.fn(async () => manager);
  const cache = createDuckdbAnalyticsCache(factory);

  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  expect(first).toBe(second);
  expect(factory).toHaveBeenCalledTimes(1);
  await Promise.all([cache.close(), cache.close()]);
  expect(close).toHaveBeenCalledTimes(1);
});
