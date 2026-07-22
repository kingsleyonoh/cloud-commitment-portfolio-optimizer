import type { SqlFile, SqlPlanKind } from "./sql-plan.js";

export interface AppliedSqlFile {
  version: string;
  filename: string;
  checksum: string;
}

export class SchemaDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaDriftError";
  }
}

export function validateAppliedPlan(
  kind: SqlPlanKind,
  files: readonly SqlFile[],
  appliedRows: readonly AppliedSqlFile[],
): Map<string, AppliedSqlFile> {
  const planned = new Map(files.map((file) => [file.version, file]));
  const applied = new Map(appliedRows.map((row) => [row.version, row]));
  for (const row of appliedRows) validateAppliedFile(kind, planned, row);
  validateAppendOnlyOrder(kind, files, appliedRows, applied);
  return applied;
}

function validateAppliedFile(
  kind: SqlPlanKind,
  planned: ReadonlyMap<string, SqlFile>,
  applied: AppliedSqlFile,
): void {
  const file = planned.get(applied.version);
  if (!file) {
    throw new SchemaDriftError(
      `Applied ${kind} ${applied.version} (${applied.filename}) is missing from disk. Restore it before continuing.`,
    );
  }
  if (file.filename !== applied.filename) {
    throw new SchemaDriftError(
      `Filename drift for ${kind} ${applied.version}: applied ${applied.filename}, found ${file.filename}.`,
    );
  }
  if (file.checksum !== applied.checksum) {
    throw new SchemaDriftError(
      `Checksum drift detected for ${kind} ${applied.version} (${file.filename}). Applied files are immutable.`,
    );
  }
}

function validateAppendOnlyOrder(
  kind: SqlPlanKind,
  files: readonly SqlFile[],
  rows: readonly AppliedSqlFile[],
  applied: ReadonlyMap<string, AppliedSqlFile>,
): void {
  const highest = highestVersion(rows);
  if (highest === undefined) return;
  const outOfOrder = files.find(
    (file) => !applied.has(file.version) && BigInt(file.version) < highest,
  );
  if (!outOfOrder) return;
  throw new SchemaDriftError(
    `Out-of-order ${kind} ${outOfOrder.version} (${outOfOrder.filename}) cannot be applied after version ${highest}. Add a new higher version instead.`,
  );
}

function highestVersion(rows: readonly AppliedSqlFile[]): bigint | undefined {
  return rows.reduce<bigint | undefined>((highest, row) => {
    const version = BigInt(row.version);
    return highest === undefined || version > highest ? version : highest;
  }, undefined);
}
