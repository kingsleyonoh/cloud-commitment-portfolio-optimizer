export interface ApiKeyMetadata {
  id: string;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyMetadataRecord {
  id: string;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ApiKeyMetadataQuery {
  limit: number;
  cursor?: string;
}

export interface ApiKeyMetadataCursorBoundary {
  createdAt: string;
  id: string;
}

export interface ApiKeyMetadataPage {
  api_keys: ApiKeyMetadata[];
  next_cursor: string | null;
}
