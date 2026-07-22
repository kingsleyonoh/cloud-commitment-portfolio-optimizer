import { createHash, timingSafeEqual } from "node:crypto";

import { AppError } from "../shared/errors.js";
import { parseUserId, parseUserTimestamp } from "./users-input.js";
import type { UserCursorBoundary } from "./users-types.js";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;

interface CursorPayload {
  v: number;
  created_at: string;
  id: string;
  check: string;
}

export function encodeUsersCursor(boundary: UserCursorBoundary): string {
  const createdAt = parseUserTimestamp(boundary.createdAt);
  const id = parseUserId(boundary.id);
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    created_at: createdAt,
    id,
    check: checksum(createdAt, id),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  if (encoded.length > MAX_CURSOR_LENGTH) throw invalid();
  return encoded;
}

export function decodeUsersCursor(cursor: string): UserCursorBoundary {
  try {
    if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !CURSOR_PATTERN.test(cursor)) {
      throw invalid();
    }
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw invalid();
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (!isCursorPayload(value)) throw invalid();
    const createdAt = parseUserTimestamp(value.created_at);
    const id = parseUserId(value.id);
    const expected = checksum(createdAt, id);
    if (!sameText(value.check, expected)) throw invalid();
    const canonical = JSON.stringify({
      v: CURSOR_VERSION,
      created_at: createdAt,
      id,
      check: expected,
    });
    if (Buffer.from(canonical, "utf8").toString("base64url") !== cursor) throw invalid();
    return { createdAt, id };
  } catch {
    throw invalid();
  }
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === 4 &&
    keys.join(",") === "check,created_at,id,v" &&
    record.v === CURSOR_VERSION &&
    typeof record.created_at === "string" &&
    typeof record.id === "string" &&
    typeof record.check === "string"
  );
}

function checksum(createdAt: string, id: string): string {
  return createHash("sha256")
    .update(`users-cursor:v1\n${createdAt}\n${id}`, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function sameText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
