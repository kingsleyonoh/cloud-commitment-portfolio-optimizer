import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface LocalWorkspaceOptions {
  root?: string;
  duckdbTempDir: string;
  objectStoragePath: string;
  reportStoragePath: string;
}

export interface LocalWorkspaceResult {
  created: string[];
}

function resolveUnderRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      throw new Error(`local workspace path is not a directory: ${path}`);
    }
    return;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOTDIR") {
      throw new Error(`local workspace path is not a directory: ${path}`);
    }
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOTDIR") {
      throw new Error(`local workspace path is not a directory: ${path}`);
    }
    throw error;
  }
}

export async function ensureLocalWorkspace(
  options: LocalWorkspaceOptions,
): Promise<LocalWorkspaceResult> {
  const root = resolve(options.root ?? process.cwd());
  const requiredPaths = [
    resolveUnderRoot(root, options.duckdbTempDir),
    resolveUnderRoot(root, options.objectStoragePath),
    resolveUnderRoot(root, options.reportStoragePath),
  ];

  for (const path of requiredPaths) {
    await ensureDirectory(path);
  }

  return { created: requiredPaths };
}
