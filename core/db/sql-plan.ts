import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type SqlPlanKind = "migration" | "setup";

export interface SqlFile {
  version: string;
  name: string;
  filename: string;
  path: string;
  checksum: string;
  sql: string;
}

export class MigrationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationPlanError";
  }
}

const sqlFilename = /^(\d{4,})_([a-z0-9][a-z0-9_-]*)\.sql$/u;

export async function discoverSqlFiles(directory: string, kind: SqlPlanKind): Promise<SqlFile[]> {
  const entries = validateSqlEntries(await readSqlDirectory(directory, kind), directory, kind);
  const files = await Promise.all(entries.map((entry) => loadSqlFile(directory, kind, entry)));
  files.sort(compareSqlFiles);
  validateUniqueVersions(kind, files);
  return files;
}

async function readSqlDirectory(directory: string, kind: SqlPlanKind): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new MigrationPlanError(
      `Cannot read ${planLabel(kind)} directory ${directory}: ${errorMessage(error)}`,
    );
  }
}

function validateSqlEntries(
  entries: readonly Dirent[],
  directory: string,
  kind: SqlPlanKind,
): Dirent[] {
  const sqlEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"));
  const malformed = sqlEntries.find((entry) => !sqlFilename.test(entry.name));
  if (malformed) {
    throw new MigrationPlanError(
      `Invalid ${planLabel(kind)} filename ${malformed.name}; expected NNNN_description.sql.`,
    );
  }
  if (sqlEntries.length === 0) {
    throw new MigrationPlanError(`No ${planLabel(kind)} files found in ${directory}.`);
  }
  return sqlEntries;
}

async function loadSqlFile(directory: string, kind: SqlPlanKind, entry: Dirent): Promise<SqlFile> {
  const match = sqlFilename.exec(entry.name);
  if (!match?.[1] || !match[2]) {
    throw new MigrationPlanError(`Invalid ${planLabel(kind)} filename ${entry.name}.`);
  }
  const path = join(directory, entry.name);
  const content = await readFile(path);
  return {
    version: match[1],
    name: match[2],
    filename: entry.name,
    path,
    checksum: createHash("sha256").update(content).digest("hex"),
    sql: content.toString("utf8"),
  };
}

function compareSqlFiles(left: SqlFile, right: SqlFile): number {
  const versionOrder = BigInt(left.version) - BigInt(right.version);
  if (versionOrder < 0n) return -1;
  if (versionOrder > 0n) return 1;
  return left.filename.localeCompare(right.filename);
}

function validateUniqueVersions(kind: SqlPlanKind, files: readonly SqlFile[]): void {
  for (let index = 1; index < files.length; index += 1) {
    const previous = files[index - 1];
    const current = files[index];
    if (previous && current && BigInt(previous.version) === BigInt(current.version)) {
      throw new MigrationPlanError(
        `Duplicate ${planLabel(kind)} version ${current.version}: ${previous.filename} and ${current.filename}.`,
      );
    }
  }
}

function planLabel(kind: SqlPlanKind): string {
  return kind === "migration" ? "migration" : "setup";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
