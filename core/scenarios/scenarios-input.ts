import { AppError } from "../shared/errors.js";
import { decodeForecastCursor } from "../forecasting/forecast-cursor.js";
import type { ScenarioCreateInput, ScenarioListInput, ScenarioStatus } from "./scenarios-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function parseScenarioId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

export function parseScenarioCreateBody(value: unknown): ScenarioCreateInput {
  const object = record(value);
  const allowed = new Set(["name", "description", "base_forecast_run_id", "shock_config"]);
  if (Object.keys(object).some((key) => !allowed.has(key))) throw invalid();
  if (typeof object.name !== "string") throw invalid();
  const name = text(object.name, 200);
  const description = object.description === undefined ? undefined : text(object.description, 2000);
  const baseForecastRunId =
    object.base_forecast_run_id === undefined ? undefined : uuid(object.base_forecast_run_id);
  const shockConfig = object.shock_config === undefined ? {} : config(object.shock_config);
  return Object.freeze({
    name,
    ...(description === undefined ? {} : { description }),
    ...(baseForecastRunId === undefined ? {} : { baseForecastRunId }),
    shockConfig,
  });
}

export function parseScenarioListQuery(value: unknown): ScenarioListInput {
  const object = record(value);
  const allowed = new Set(["limit", "cursor", "status"]);
  if (Object.keys(object).some((key) => !allowed.has(key))) throw invalid();
  const limit = object.limit === undefined ? 25 : boundedLimit(object.limit);
  const status = object.status === undefined ? undefined : scenarioStatus(object.status);
  const cursor = object.cursor === undefined ? undefined : decodeScenarioCursor(object.cursor);
  return {
    limit,
    ...(status === undefined ? {} : { status }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function decodeScenarioCursor(value: unknown): { createdAt: string; id: string } {
  if (typeof value !== "string") throw invalid();
  return decodeForecastCursor(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") throw invalid();
  const result = value.normalize("NFC").trim();
  if (!result || [...result].length > max || hasControlCharacters(result)) throw invalid();
  return result;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

function config(value: unknown): Record<string, unknown> {
  const result = record(value);
  const encoded = JSON.stringify(result);
  if (
    encoded.length > 65_536 ||
    /credentials?|password|secret|token|raw_(?:file|bytes|row|rows)/iu.test(encoded)
  ) {
    throw invalid();
  }
  return Object.freeze({ ...result });
}

function boundedLimit(value: unknown): number {
  if (typeof value !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) throw invalid();
  return Number(value);
}

function scenarioStatus(value: unknown): ScenarioStatus {
  if (value !== "draft" && value !== "ready" && value !== "archived") throw invalid();
  return value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
  });
}
