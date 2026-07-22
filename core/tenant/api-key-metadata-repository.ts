import type { Pool, QueryResultRow } from "pg";

import type {
  ApiKeyMetadataCursorBoundary,
  ApiKeyMetadataRecord,
} from "./api-key-metadata-types.js";

export interface ApiKeyMetadataRepository {
  list(input: {
    tenantId: string;
    limit: number;
    cursor?: ApiKeyMetadataCursorBoundary;
  }): Promise<ApiKeyMetadataRecord[]>;
}

interface ApiKeyMetadataRow extends QueryResultRow {
  id: string;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const API_KEY_METADATA_PROJECTION = `id, note,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  CASE WHEN revoked_at IS NULL THEN NULL
    ELSE to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  END AS "revokedAt"`;

export function createApiKeyMetadataRepository(pool: Pool): ApiKeyMetadataRepository {
  return {
    async list(input) {
      const cursor = input.cursor;
      const result = await pool.query<ApiKeyMetadataRow>(
        `SELECT ${API_KEY_METADATA_PROJECTION}
         FROM api_keys
         WHERE tenant_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [input.tenantId, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1],
      );
      return result.rows.map(toRecord);
    },
  };
}

function toRecord(row: ApiKeyMetadataRow): ApiKeyMetadataRecord {
  return Object.freeze({
    id: row.id,
    note: row.note,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  });
}
