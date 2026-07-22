import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { AppError } from "./errors.js";
import { createManagedCache, type ManagedCache } from "./lifecycle.js";
import {
  assertStableObjectParent,
  prepareObjectWritePath,
  resolveExistingObjectPath,
} from "./objectStorePaths.js";

export interface ObjectStoreHealth {
  ready: boolean;
  code?: string;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  health(): Promise<ObjectStoreHealth>;
  close(): Promise<void>;
}

export type ObjectStoreFactory = () => ObjectStore | Promise<ObjectStore>;

export function createObjectStoreCache(factory: ObjectStoreFactory): ManagedCache<ObjectStore> {
  return createManagedCache(factory, (store) => store.close());
}

interface LocalObjectStoreState {
  closed: boolean;
  root: string;
}

export function createLocalObjectStore(rootPath: string): ObjectStore {
  const state: LocalObjectStoreState = { closed: false, root: resolve(rootPath) };
  return {
    put: (key, bytes) => putLocalObject(state, key, bytes),
    get: (key) => getLocalObject(state, key),
    delete: (key) => deleteLocalObject(state, key),
    health: () => localObjectHealth(state),
    close: async () => {
      state.closed = true;
    },
  };
}

async function putLocalObject(
  state: LocalObjectStoreState,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  assertOpen(state.closed);
  const { destination, parent } = await prepareObjectWritePath(state.root, key);
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await assertStableObjectParent(parent);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function getLocalObject(state: LocalObjectStoreState, key: string): Promise<Buffer> {
  assertOpen(state.closed);
  try {
    return await readObjectFile(await resolveExistingObjectPath(state.root, key));
  } catch (error) {
    if (isMissingFile(error)) throw objectNotFound();
    throw error;
  }
}

async function deleteLocalObject(state: LocalObjectStoreState, key: string): Promise<void> {
  assertOpen(state.closed);
  try {
    await rm(await resolveExistingObjectPath(state.root, key));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function localObjectHealth(state: LocalObjectStoreState): Promise<ObjectStoreHealth> {
  if (state.closed) return { ready: false, code: "OBJECT_STORE_CLOSED" };
  await verifyWritable(state.root);
  return { ready: true };
}

async function readObjectFile(path: string): Promise<Buffer> {
  const noFollow =
    "O_NOFOLLOW" in constants
      ? (constants as typeof constants & { O_NOFOLLOW: number }).O_NOFOLLOW
      : 0;
  const file = await open(path, constants.O_RDONLY | noFollow);
  try {
    const [opened, current] = await Promise.all([file.stat(), lstat(path)]);
    if (current.isSymbolicLink() || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw objectPathChanged();
    }
    return await file.readFile();
  } finally {
    await file.close();
  }
}

async function verifyWritable(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  const probe = resolve(await realpath(root), `.health-${randomUUID()}`);
  try {
    await writeFile(probe, "ready", { flag: "wx" });
  } finally {
    await rm(probe, { force: true });
  }
}

function assertOpen(closed: boolean): void {
  if (closed) {
    throw new AppError({
      code: "OBJECT_STORE_CLOSED",
      message: "The object store is closed.",
      statusCode: 503,
    });
  }
}

function objectPathChanged(): AppError {
  return new AppError({
    code: "OBJECT_KEY_INVALID",
    message: "The object path changed during a guarded filesystem operation.",
    statusCode: 400,
  });
}

function objectNotFound(): AppError {
  return new AppError({
    code: "OBJECT_NOT_FOUND",
    message: "The requested object does not exist.",
    statusCode: 404,
  });
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

let objectStoreRoot: string | undefined;
const objectStoreCache = createObjectStoreCache(() => {
  if (!objectStoreRoot) throw invalidObjectStoreConfig();
  return createLocalObjectStore(objectStoreRoot);
});

export function getObjectStore(rootPath: string): Promise<ObjectStore> {
  objectStoreRoot ??= rootPath;
  return objectStoreCache.get();
}

export async function closeObjectStore(): Promise<void> {
  try {
    await objectStoreCache.close();
  } finally {
    objectStoreRoot = undefined;
  }
}

function invalidObjectStoreConfig(): AppError {
  return new AppError({
    code: "OBJECT_STORE_NOT_CONFIGURED",
    message: "The local object store has not been configured.",
    statusCode: 503,
  });
}
