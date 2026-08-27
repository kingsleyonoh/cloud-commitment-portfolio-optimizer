import { AppError } from "../shared/errors.js";
import type { ApiKeyRotationInput } from "./api-key-rotation-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ALLOWED_KEYS = ["api_key_id", "note"] as const;

export function parseApiKeyRotationBody(input: unknown): ApiKeyRotationInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid();
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.includes(key as never))) throw invalid();
  if (typeof body.api_key_id !== "string" || !UUID_PATTERN.test(body.api_key_id)) throw invalid();
  return {
    apiKeyId: body.api_key_id,
    note: body.note === undefined ? null : normalizeNote(body.note),
  };
}

function normalizeNote(input: unknown): string {
  if (typeof input !== "string") throw invalid();
  const note = input.normalize("NFC");
  if (
    note.length === 0 ||
    note.trim() !== note ||
    [...note].length > 200 ||
    hasControlCharacter(note)
  ) {
    throw invalid();
  }
  return note;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "API-key rotation request is invalid.",
    statusCode: 400,
    details: [],
  });
}
