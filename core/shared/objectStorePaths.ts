import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AppError } from "./errors.js";

export interface SafeWritePath {
  destination: string;
  parent: string;
}

export async function prepareObjectWritePath(
  rootPath: string,
  key: string,
): Promise<SafeWritePath> {
  const segments = validateObjectKey(key);
  await mkdir(rootPath, { recursive: true });
  const canonicalRoot = await realpath(rootPath);
  const parent = await walkObjectParents(rootPath, canonicalRoot, segments.slice(0, -1), true);
  const destination = join(parent, segments.at(-1)!);
  await rejectSymlinkIfPresent(destination);
  return { destination, parent };
}

export async function resolveExistingObjectPath(rootPath: string, key: string): Promise<string> {
  const segments = validateObjectKey(key);
  const canonicalRoot = await realpath(rootPath);
  const parent = await walkObjectParents(rootPath, canonicalRoot, segments.slice(0, -1), false);
  const target = join(parent, segments.at(-1)!);
  await rejectSymlink(target);
  const canonicalTarget = await realpath(target);
  assertContained(canonicalRoot, canonicalTarget);
  return canonicalTarget;
}

export async function assertStableObjectParent(parent: string): Promise<void> {
  await rejectSymlink(parent);
  const current = await realpath(parent);
  if (current !== parent) throw invalidKey();
}

function validateObjectKey(key: string): string[] {
  if (!key || key.includes("\\") || isAbsolute(key)) throw invalidKey();
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw invalidKey();
  }
  const target = resolve("/object-root", ...segments);
  if (!isContained("/object-root", target)) throw invalidKey();
  return segments;
}

async function walkObjectParents(
  rootPath: string,
  canonicalRoot: string,
  segments: readonly string[],
  create: boolean,
): Promise<string> {
  let lexicalParent = rootPath;
  let canonicalParent = canonicalRoot;
  for (const segment of segments) {
    lexicalParent = join(lexicalParent, segment);
    if (create) await mkdir(lexicalParent).catch(ignoreExistingDirectory);
    await rejectSymlink(lexicalParent);
    canonicalParent = await realpath(lexicalParent);
    assertContained(canonicalRoot, canonicalParent);
  }
  return canonicalParent;
}

async function rejectSymlink(path: string): Promise<void> {
  if ((await lstat(path)).isSymbolicLink()) throw invalidKey();
}

async function rejectSymlinkIfPresent(path: string): Promise<void> {
  try {
    await rejectSymlink(path);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

function ignoreExistingDirectory(error: unknown): void {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
}

function assertContained(root: string, target: string): void {
  if (!isContained(root, target)) throw invalidKey();
}

function isContained(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function invalidKey(): AppError {
  return new AppError({
    code: "OBJECT_KEY_INVALID",
    message: "The object key must remain within the configured object-store root.",
    statusCode: 400,
  });
}
