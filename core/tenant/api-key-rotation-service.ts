import { AppError } from "../shared/errors.js";
import { createApiKeyCredential, type ApiKeyCredential } from "./api-key-credential.js";
import { parseApiKeyRotationBody } from "./api-key-rotation-input.js";
import type { ApiKeyRotationRepository } from "./api-key-rotation-repository.js";
import type { ApiKeyRotationResponse } from "./api-key-rotation-types.js";
import type { UserRequestContext } from "./request-context.js";

export type RotationCredentialFactory = () => ApiKeyCredential;

export interface ApiKeyRotationService {
  rotate(context: UserRequestContext, body: unknown): Promise<ApiKeyRotationResponse>;
}

export function createApiKeyRotationService(
  repository: ApiKeyRotationRepository,
  apiKeyPrefix: string,
  credentialFactory: RotationCredentialFactory = () => createApiKeyCredential(apiKeyPrefix),
): ApiKeyRotationService {
  return {
    async rotate(context, body) {
      const input = parseApiKeyRotationBody(body);
      let credential: ApiKeyCredential;
      try {
        credential = credentialFactory();
      } catch {
        throw unavailable();
      }
      const committed = await repository.rotate({
        tenantId: context.tenantId,
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        apiKeyId: input.apiKeyId,
        note: input.note,
        keyHash: credential.keyHash,
      });
      return {
        revoked_api_key: committed.revokedApiKey,
        replacement_api_key: committed.replacementApiKey,
        audit_id: committed.auditId,
        apiKey: credential.plaintext,
      };
    },
  };
}

function unavailable(): AppError {
  return new AppError({
    code: "API_KEY_ROTATION_UNAVAILABLE",
    message: "API-key rotation is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
