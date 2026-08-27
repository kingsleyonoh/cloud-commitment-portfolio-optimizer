import { decodeForecastCursor, encodeForecastCursor } from "../forecasting/forecast-cursor.js";
import type { AuditRecord } from "./audit-types.js";

export function encodeAuditCursor(row: Pick<AuditRecord, "createdAt" | "id">): string {
  return encodeForecastCursor(row);
}

export function decodeAuditCursor(value: string): { createdAt: string; id: string } {
  return decodeForecastCursor(value);
}
