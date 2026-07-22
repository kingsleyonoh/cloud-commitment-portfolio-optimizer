import { expect, it, vi } from "vitest";
import { createManagedCache } from "../../../core/shared/lifecycle.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, reject, resolve };
}

it("coalesces concurrent acquisition into one factory promise", async () => {
  const pending = deferred<{ id: number }>();
  const factory = vi.fn(() => pending.promise);
  const cache = createManagedCache(factory);

  const first = cache.get();
  const second = cache.get();
  pending.resolve({ id: 1 });

  expect(await first).toBe(await second);
  expect(factory).toHaveBeenCalledTimes(1);
  await cache.close();
});

it("clears failed initialization so a later acquisition retries", async () => {
  const resource = { id: 2 };
  const factory = vi
    .fn<() => Promise<typeof resource>>()
    .mockRejectedValueOnce(new Error("factory failed"))
    .mockResolvedValueOnce(resource);
  const cache = createManagedCache(factory);

  await expect(cache.get()).rejects.toThrow("factory failed");
  await expect(cache.get()).resolves.toBe(resource);
  expect(factory).toHaveBeenCalledTimes(2);
  await cache.close();
});

it("closes one acquired resource exactly once and returns to idle", async () => {
  const close = vi.fn(async () => undefined);
  const factory = vi.fn(async () => ({ close }));
  const cache = createManagedCache(factory, (resource) => resource.close());

  await cache.get();
  await Promise.all([cache.close(), cache.close(), cache.reset()]);
  expect(close).toHaveBeenCalledTimes(1);

  await cache.get();
  expect(factory).toHaveBeenCalledTimes(2);
  await cache.close();
  expect(close).toHaveBeenCalledTimes(2);
});

it("serializes close against acquisition and starts a fresh generation afterward", async () => {
  const firstPending = deferred<{ generation: number; close(): Promise<void> }>();
  const firstClose = deferred<void>();
  const second = { generation: 2, close: vi.fn(async () => undefined) };
  const factory = vi
    .fn<() => Promise<{ generation: number; close(): Promise<void> }>>()
    .mockReturnValueOnce(firstPending.promise)
    .mockResolvedValueOnce(second);
  const cache = createManagedCache(factory, (resource) => resource.close());

  const firstGet = cache.get();
  const closing = cache.close();
  const nextGet = cache.get();
  firstPending.resolve({ generation: 1, close: () => firstClose.promise });

  await expect(firstGet).resolves.toMatchObject({ generation: 1 });
  expect(factory).toHaveBeenCalledTimes(1);
  firstClose.resolve();
  await closing;
  await expect(nextGet).resolves.toBe(second);
  expect(factory).toHaveBeenCalledTimes(2);
  await cache.close();
});

it("propagates disposer failure while still permitting reacquisition", async () => {
  const factory = vi.fn(async () => ({ id: factory.mock.calls.length }));
  const dispose = vi
    .fn()
    .mockRejectedValueOnce(new Error("close failed"))
    .mockResolvedValue(undefined);
  const cache = createManagedCache(factory, dispose);

  await cache.get();
  await expect(cache.close()).rejects.toThrow("close failed");
  await expect(cache.get()).resolves.toEqual({ id: 2 });
  await cache.close();
});
