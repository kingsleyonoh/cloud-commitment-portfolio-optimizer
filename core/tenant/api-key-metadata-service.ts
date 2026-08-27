import { AppError } from "../shared/errors.js";
import {
  decodeApiKeyMetadataCursor,
  encodeApiKeyMetadataCursor,
} from "./api-key-metadata-cursor.js";
import { parseApiKeyMetadataQuery } from "./api-key-metadata-input.js";
import type { ApiKeyMetadataRepository } from "./api-key-metadata-repository.js";
import type {
  ApiKeyMetadata,
  ApiKeyMetadataPage,
  ApiKeyMetadataRecord,
} from "./api-key-metadata-types.js";
import type { UserRequestContext } from "./request-context.js";

export interface ApiKeyMetadataService {
  list(context: UserRequestContext, query: unknown): Promise<ApiKeyMetadataPage>;
}

export function createApiKeyMetadataService(
  repository: ApiKeyMetadataRepository,
): ApiKeyMetadataService {
  return {
    async list(context, query) {
      const parsed = parseApiKeyMetadataQuery(query);
      const cursor = parsed.cursor ? decodeApiKeyMetadataCursor(parsed.cursor) : undefined;
      let rows: ApiKeyMetadataRecord[];
      try {
        rows = await repository.list({
          tenantId: context.tenantId,
          limit: parsed.limit,
          ...(cursor ? { cursor } : {}),
        });
      } catch {
        throw unavailable();
      }
      const selected = rows.slice(0, parsed.limit);
      const last = selected.at(-1);
      return {
        api_keys: selected.map(toMetadata),
        next_cursor: rows.length > parsed.limit && last ? encodeApiKeyMetadataCursor(last) : null,
      };
    },
  };
}

function toMetadata(row: ApiKeyMetadataRecord): ApiKeyMetadata {
  return {
    id: row.id,
    note: row.note,
    created_at: row.createdAt,
    revoked_at: row.revokedAt,
  };
}

function unavailable(): AppError {
  return new AppError({
    code: "API_KEYS_UNAVAILABLE",
    message: "API-key metadata is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
