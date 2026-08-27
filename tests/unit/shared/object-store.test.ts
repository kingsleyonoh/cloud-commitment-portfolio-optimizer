import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createLocalObjectStore,
  createObjectStoreCache,
} from "../../../core/shared/objectStore.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "ccpo-object-store-"));
  roots.push(root);
  return root;
}

async function symlinkEscapeFixture() {
  const sandbox = await tempRoot();
  const root = join(sandbox, "root");
  const outside = join(sandbox, "outside");
  await Promise.all([mkdir(root), mkdir(outside)]);
  await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  return { outside, root };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("persists, atomically overwrites, reads, and deletes real files", async () => {
  const root = await tempRoot();
  const store = createLocalObjectStore(root);

  await expect(store.health()).resolves.toEqual({ ready: true });
  await store.put("tenant-a/imports/data.bin", Buffer.from("first"));
  await store.put("tenant-a/imports/data.bin", Buffer.from("second"));
  await expect(store.get("tenant-a/imports/data.bin")).resolves.toEqual(Buffer.from("second"));
  expect(await readFile(join(root, "tenant-a/imports/data.bin"), "utf8")).toBe("second");
  expect(
    (await readdir(join(root, "tenant-a/imports"))).some((name) => name.includes(".tmp-")),
  ).toBe(false);
  await store.delete("tenant-a/imports/data.bin");
  await expect(store.get("tenant-a/imports/data.bin")).rejects.toMatchObject({
    code: "OBJECT_NOT_FOUND",
  });
  await store.close();
});

it("rejects empty, absolute, backslash, and traversal keys", async () => {
  const store = createLocalObjectStore(await tempRoot());

  for (const key of [
    "",
    "/absolute",
    "C:\\absolute",
    "../escape",
    "ok/../../escape",
    "ok\\..\\escape",
  ]) {
    await expect(store.put(key, Buffer.from("x"))).rejects.toMatchObject({
      code: "OBJECT_KEY_INVALID",
    });
  }
  await store.close();
});

it("rejects real symlink or junction escapes for read, write, and delete", async () => {
  const { outside, root } = await symlinkEscapeFixture();
  await Promise.all([
    writeFile(join(outside, "read.txt"), "outside-read"),
    writeFile(join(outside, "delete.txt"), "outside-delete"),
  ]);
  const store = createLocalObjectStore(root);

  await expect(store.get("linked/read.txt")).rejects.toMatchObject({ code: "OBJECT_KEY_INVALID" });
  await expect(store.put("linked/write.txt", Buffer.from("escape"))).rejects.toMatchObject({
    code: "OBJECT_KEY_INVALID",
  });
  await expect(store.delete("linked/delete.txt")).rejects.toMatchObject({
    code: "OBJECT_KEY_INVALID",
  });
  await expect(readFile(join(outside, "delete.txt"), "utf8")).resolves.toBe("outside-delete");
  await expect(access(join(outside, "write.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  await store.close();
});

it("coalesces concurrent creation and closes/reset cleanly", async () => {
  const root = await tempRoot();
  const store = createLocalObjectStore(root);
  const close = vi.spyOn(store, "close");
  const factory = vi.fn(async () => store);
  const cache = createObjectStoreCache(factory);

  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  expect(first).toBe(second);
  expect(factory).toHaveBeenCalledTimes(1);
  await Promise.all([cache.close(), cache.close()]);
  expect(close).toHaveBeenCalledTimes(1);
});

it("fails operations explicitly after adapter close", async () => {
  const store = createLocalObjectStore(await tempRoot());
  await store.close();

  await expect(store.health()).resolves.toEqual({ ready: false, code: "OBJECT_STORE_CLOSED" });
  await expect(store.put("x", Buffer.from("x"))).rejects.toMatchObject({
    code: "OBJECT_STORE_CLOSED",
  });
});
