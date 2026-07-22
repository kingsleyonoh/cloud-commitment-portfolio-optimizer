export interface ApiKeyRotationInput {
  apiKeyId: string;
  note: string | null;
}

export interface ApiKeyRotationMetadata {
  id: string;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyRotationCommitted {
  revokedApiKey: ApiKeyRotationMetadata & { revoked_at: string };
  replacementApiKey: ApiKeyRotationMetadata & { revoked_at: null };
  auditId: string;
}

export interface ApiKeyRotationResponse {
  revoked_api_key: ApiKeyRotationMetadata & { revoked_at: string };
  replacement_api_key: ApiKeyRotationMetadata & { revoked_at: null };
  audit_id: string;
  apiKey: string;
}
