import { createHash, timingSafeEqual } from "node:crypto";

import {
  invalidApiKeyMetadataRequest,
  parseApiKeyMetadataId,
  parseApiKeyMetadataTimestamp,
} from "./api-key-metadata-input.js";
import type { ApiKeyMetadataCursorBoundary } from "./api-key-metadata-types.js";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;

interface CursorPayload {
  v: number;
  created_at: string;
  id: string;
  check: string;
}

export function encodeApiKeyMetadataCursor(boundary: ApiKeyMetadataCursorBoundary): string {
  const createdAt = parseApiKeyMetadataTimestamp(boundary.createdAt);
  const id = parseApiKeyMetadataId(boundary.id);
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    created_at: createdAt,
    id,
    check: checksum(createdAt, id),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  if (encoded.length > MAX_CURSOR_LENGTH) throw invalidApiKeyMetadataRequest();
  return encoded;
}

export function decodeApiKeyMetadataCursor(cursor: string): ApiKeyMetadataCursorBoundary {
  try {
    if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !CURSOR_PATTERN.test(cursor)) {
      throw invalidApiKeyMetadataRequest();
    }
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw invalidApiKeyMetadataRequest();
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (!isCursorPayload(value)) throw invalidApiKeyMetadataRequest();
    const createdAt = parseApiKeyMetadataTimestamp(value.created_at);
    const id = parseApiKeyMetadataId(value.id);
    const expected = checksum(createdAt, id);
    if (!sameText(value.check, expected)) throw invalidApiKeyMetadataRequest();
    const canonical = JSON.stringify({
      v: CURSOR_VERSION,
      created_at: createdAt,
      id,
      check: expected,
    });
    if (Buffer.from(canonical, "utf8").toString("base64url") !== cursor) {
      throw invalidApiKeyMetadataRequest();
    }
    return { createdAt, id };
  } catch {
    throw invalidApiKeyMetadataRequest();
  }
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") === "check,created_at,id,v" &&
    record.v === CURSOR_VERSION &&
    typeof record.created_at === "string" &&
    typeof record.id === "string" &&
    typeof record.check === "string"
  );
}

function checksum(createdAt: string, id: string): string {
  return createHash("sha256")
    .update(`api-key-metadata-cursor:v1\n${createdAt}\n${id}`, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function sameText(left: string, right: string): boolean {
  const first = Buffer.from(left, "utf8");
  const second = Buffer.from(right, "utf8");
  return first.length === second.length && timingSafeEqual(first, second);
}
