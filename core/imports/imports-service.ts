import type { ObjectStore } from "../shared/objectStore.js";
import { AppError } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { RequestContext } from "../tenant/request-context.js";
import { parseImportCreateBody } from "./imports-input.js";
import type { ImportsRepository } from "./imports-repository.js";
import type { ImportBatch, ImportBatchRecord } from "./imports-types.js";
import { parseSyntheticCsvImport } from "./synthetic-csv-parser.js";

export interface ImportsService {
  create(context: RequestContext, body: unknown): Promise<ImportBatch>;
}

export function createImportsService(
  repository: ImportsRepository,
  objectStore: ObjectStore,
  logger: Logger,
): ImportsService {
  return {
    create: (context, body) => createImport(repository, objectStore, logger, context, body),
  };
}

async function createImport(
  repository: ImportsRepository,
  objectStore: ObjectStore,
  logger: Logger,
  context: RequestContext,
  body: unknown,
): Promise<ImportBatch> {
  const input = parseImportCreateBody(body);
  const account = await safe(() =>
    repository.getCloudAccount(context.tenantId, input.cloudAccountId),
  );
  if (!account) throw notFound();
  if (!account.isActive) throw inactiveAccount();
  const bytes = await safeObjectRead(() => objectStore.get(input.objectUri));
  const parseResult = parseSyntheticCsvImport(bytes, account.provider, input.controlTotals);
  const batch = await safe(() =>
    repository.createSyntheticCsvImport({
      tenantId: context.tenantId,
      createdByUserId: context.actorUserId,
      create: input,
      parseResult,
    }),
  );
  await logImport(logger, context, batch);
  return toImportBatch(batch);
}

function toImportBatch(row: ImportBatchRecord): ImportBatch {
  return {
    id: row.id,
    cloud_account_id: row.cloudAccountId,
    source: row.source,
    format: row.format,
    status: row.status,
    object_uri: row.objectUri,
    schema_version: row.schemaVersion,
    line_count: row.lineCount,
    error_details: row.errorDetails,
    parser_warnings: row.parserWarnings,
    created_by_user_id: row.createdByUserId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function logImport(
  logger: Logger,
  context: RequestContext,
  batch: ImportBatchRecord,
): Promise<void> {
  await logger.info(
    batch.status === "completed"
      ? "cloud_commitment.import.completed"
      : "cloud_commitment.import.quarantined",
    {
      requestId: context.requestId,
      tenantId: context.tenantId,
      actorType: context.actorType,
      actorUserId: context.actorUserId,
      apiKeyId: context.apiKeyId,
      importBatchId: batch.id,
      cloudAccountId: batch.cloudAccountId,
      source: batch.source,
      format: batch.format,
      status: batch.status,
      lineCount: batch.lineCount,
    },
  );
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw unavailable();
  }
}

async function safeObjectRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) throw missingObject();
    if (error instanceof AppError && error.statusCode === 400) throw error;
    throw unavailable();
  }
}

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    statusCode: 404,
    details: [],
  });
}

function missingObject(): AppError {
  return new AppError({
    code: "IMPORT_OBJECT_NOT_FOUND",
    message: "The import object was not found.",
    statusCode: 404,
    details: [],
  });
}

function inactiveAccount(): AppError {
  return new AppError({
    code: "IMPORT_ACCOUNT_INACTIVE",
    message: "The cloud account cannot accept imports.",
    statusCode: 409,
    details: [],
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "IMPORTS_UNAVAILABLE",
    message: "Import processing is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
