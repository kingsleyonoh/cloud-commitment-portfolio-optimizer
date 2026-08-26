import type { ScenarioRecord } from "./scenarios-types.js";

export function encodeScenarioCursor(row: Pick<ScenarioRecord, "createdAt" | "id">): string {
  return Buffer.from(JSON.stringify({ created_at: row.createdAt, id: row.id }), "utf8").toString(
    "base64url",
  );
}
