import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PAYLOAD_BYTES = 32;
export const API_KEY_VERSION = "v1";
export const FIRST_RUN_API_KEY_NOTE = "system:first-run:v1";

const PREFIX_PATTERN = /^[a-z][a-z0-9]{0,15}$/u;

export type RandomByteSource = (size: number) => Buffer;

export interface ApiKeyCredential {
  plaintext: string;
  keyHash: string;
}

export class ApiKeyCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyCredentialError";
  }
}

export function validateApiKeyPrefix(prefix: string): string {
  const normalized = prefix.trim();
  if (!PREFIX_PATTERN.test(normalized)) {
    throw new ApiKeyCredentialError("API_KEY_PREFIX must be a safe lowercase issuance prefix.");
  }
  return normalized;
}

export function createApiKeyCredential(
  prefix: string,
  randomSource: RandomByteSource = randomBytes,
): ApiKeyCredential {
  const safePrefix = validateApiKeyPrefix(prefix);
  const entropy = randomSource(API_KEY_PAYLOAD_BYTES);
  if (entropy.length !== API_KEY_PAYLOAD_BYTES) {
    throw new ApiKeyCredentialError("The credential entropy source returned an invalid length.");
  }
  const payload = entropy.toString("base64url");
  const plaintext = `${safePrefix}_live_${API_KEY_VERSION}_${payload}`;
  const keyHash = createHash("sha256").update(plaintext, "utf8").digest("hex");
  return { plaintext, keyHash };
}
