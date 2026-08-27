import { AppError } from "../shared/errors.js";
import type { ForecastCursorBoundary } from "./forecast-types.js";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{38,512}$/u;
const TIMESTAMPTZ_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function encodeForecastCursor(row: ForecastCursorBoundary): string {
  return Buffer.from(JSON.stringify({ created_at: row.createdAt, id: row.id }), "utf8").toString(
    "base64url",
  );
}

export function decodeForecastCursor(value: string): ForecastCursorBoundary {
  if (!CURSOR_PATTERN.test(value)) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.created_at !== "string" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      !TIMESTAMPTZ_PATTERN.test(parsed.created_at)
    ) {
      throw invalid();
    }
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
