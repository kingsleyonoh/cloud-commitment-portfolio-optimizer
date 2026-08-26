import { AppError } from "../shared/errors.js";
import type { OptimizerPolicyCursorBoundary } from "./optimizer-policies-types.js";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{38,512}$/u;

export function encodeOptimizerPolicyCursor(row: OptimizerPolicyCursorBoundary): string {
  return Buffer.from(JSON.stringify({ created_at: row.createdAt, id: row.id }), "utf8").toString(
    "base64url",
  );
}

export function decodeOptimizerPolicyCursor(value: string): OptimizerPolicyCursorBoundary {
  if (!CURSOR_PATTERN.test(value)) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (typeof parsed.created_at !== "string" || typeof parsed.id !== "string") throw invalid();
    return Object.freeze({ createdAt: parsed.created_at, id: parsed.id });
  } catch {
    throw invalid();
  }
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
