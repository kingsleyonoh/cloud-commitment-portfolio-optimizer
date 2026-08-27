import { AppError } from "../shared/errors.js";
import type { ApiKeyMetadataQuery } from "./api-key-metadata-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

export function parseApiKeyMetadataQuery(input: unknown): ApiKeyMetadataQuery {
  const value = closedQuery(input);
  let limit = 25;
  if (value.limit !== undefined) {
    if (typeof value.limit !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value.limit)) {
      throw invalidApiKeyMetadataRequest();
    }
    limit = Number.parseInt(value.limit, 10);
  }
  if (value.cursor === undefined) return { limit };
  if (typeof value.cursor !== "string" || value.cursor.length === 0 || value.cursor.length > 512) {
    throw invalidApiKeyMetadataRequest();
  }
  return { limit, cursor: value.cursor };
}

export function parseApiKeyMetadataId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidApiKeyMetadataRequest();
  }
  return value;
}

export function parseApiKeyMetadataTimestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) {
    throw invalidApiKeyMetadataRequest();
  }
  const parsed = new Date(`${value.slice(0, 19)}Z`);
  if (
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw invalidApiKeyMetadataRequest();
  }
  return value;
}

function closedQuery(input: unknown): Record<"limit" | "cursor", unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidApiKeyMetadataRequest();
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "limit" && key !== "cursor")) {
    throw invalidApiKeyMetadataRequest();
  }
  return value;
}

export function invalidApiKeyMetadataRequest(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
