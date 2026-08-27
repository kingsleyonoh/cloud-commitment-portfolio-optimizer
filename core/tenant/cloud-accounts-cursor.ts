import { AppError } from "../shared/errors.js";
import type { CloudAccountCursorBoundary, CloudAccountRecord } from "./cloud-accounts-types.js";

export function encodeCloudAccountCursor(row: CloudAccountRecord): string {
  return Buffer.from(JSON.stringify({ created_at: row.createdAt, id: row.id })).toString(
    "base64url",
  );
}

export function decodeCloudAccountCursor(value: string): CloudAccountCursorBoundary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!parsed || typeof parsed !== "object") throw invalid();
  const candidate = parsed as { created_at?: unknown; id?: unknown };
  if (typeof candidate.created_at !== "string" || typeof candidate.id !== "string") {
    throw invalid();
  }
  return Object.freeze({ createdAt: candidate.created_at, id: candidate.id });
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
