import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import { decodePriceTableCursor, encodePriceTableCursor } from "./price-tables-cursor.js";
import {
  parsePriceTableCreateBody,
  parsePriceTableId,
  parsePriceTableListQuery,
} from "./price-tables-input.js";
import type { PriceTablesRepository } from "./price-tables-repository.js";
import type {
  PriceTableListPage,
  PriceTableVersion,
  PriceTableVersionRecord,
} from "./price-tables-types.js";

export interface PriceTablesService {
  create(context: RequestContext, body: unknown): Promise<PriceTableVersion>;
  list(context: RequestContext, query: unknown): Promise<PriceTableListPage>;
  activate(context: RequestContext, id: unknown): Promise<PriceTableVersion>;
}

export interface PriceTablesServiceOptions {
  staleDays: number;
  clock?: () => Date;
}

export function createPriceTablesService(
  repository: PriceTablesRepository,
  options: PriceTablesServiceOptions,
): PriceTablesService {
  const clock = options.clock ?? (() => new Date());
  return {
    create: (context, body) => createPriceTable(repository, context, body),
    list: (context, query) => listPriceTables(repository, context, query),
    activate: (context, id) =>
      activatePriceTable(repository, options.staleDays, clock, context, id),
  };
}

async function createPriceTable(
  repository: PriceTablesRepository,
  context: RequestContext,
  body: unknown,
): Promise<PriceTableVersion> {
  const input = parsePriceTableCreateBody(body);
  const row = await safe(() => repository.create(context.tenantId, input));
  return toPriceTable(row);
}

async function listPriceTables(
  repository: PriceTablesRepository,
  context: RequestContext,
  query: unknown,
): Promise<PriceTableListPage> {
  const parsed = parsePriceTableListQuery(query);
  const cursor =
    query && typeof query === "object" && typeof (query as { cursor?: unknown }).cursor === "string"
      ? decodePriceTableCursor((query as { cursor: string }).cursor)
      : undefined;
  const rows = await safe(() =>
    repository.list(context.tenantId, {
      ...parsed,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );
  const selected = rows.slice(0, parsed.limit);
  const last = selected.at(-1);
  return {
    price_tables: selected.map(toPriceTable),
    next_cursor: rows.length > parsed.limit && last ? encodePriceTableCursor(last) : null,
  };
}

async function activatePriceTable(
  repository: PriceTablesRepository,
  staleDays: number,
  clock: () => Date,
  context: RequestContext,
  idValue: unknown,
): Promise<PriceTableVersion> {
  const id = parsePriceTableId(idValue);
  const existing = await safe(() => repository.get(context.tenantId, id));
  if (!existing) throw notFound();
  if (isStale(existing.effectiveFrom, staleDays, clock())) {
    await safe(() => repository.block(context.tenantId, id));
    throw stale();
  }
  const activated = await safe(() => repository.activate(context.tenantId, id));
  if (!activated) throw notFound();
  return toPriceTable(activated);
}

function toPriceTable(row: PriceTableVersionRecord): PriceTableVersion {
  return {
    id: row.id,
    provider: row.provider,
    instrument: row.instrument,
    version_label: row.versionLabel,
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
    source_uri: row.sourceUri,
    status: row.status,
    checksum: row.checksum,
    item_count: row.itemCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function isStale(effectiveFrom: string, staleDays: number, now: Date): boolean {
  const cutoff =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - staleDays * 86_400_000;
  return Date.parse(`${effectiveFrom}T00:00:00Z`) < cutoff;
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
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

function stale(): AppError {
  return new AppError({
    code: "PRICE_TABLE_STALE",
    message: "Price table is stale.",
    statusCode: 409,
    details: [],
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "PRICE_TABLES_UNAVAILABLE",
    message: "Price tables are temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
