import { AppError } from "../shared/errors.js";
import type { NotificationCursorBoundary } from "./notifications-types.js";

export function encodeNotificationCursor(row: NotificationCursorBoundary): string {
  return Buffer.from(JSON.stringify({ created_at: row.createdAt, id: row.id }), "utf8").toString(
    "base64url",
  );
}

export function decodeNotificationCursor(value: string): NotificationCursorBoundary {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { created_at?: unknown }).created_at === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return {
        createdAt: (parsed as { created_at: string }).created_at,
        id: (parsed as { id: string }).id,
      };
    }
  } catch {
    // Fall through to the generic validation error.
  }
  throw new AppError({ code: "VALIDATION_ERROR", message: "Request is invalid.", statusCode: 400 });
}
