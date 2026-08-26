import { AppError } from "../shared/errors.js";
import type {
  OptimizerRunCreateInput,
  OptimizerRunInstrument,
  OptimizerRunProvider,
} from "./optimizer-runs-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function parseOptimizerRunCreateBody(body: unknown): OptimizerRunCreateInput {
  const object = closedRecord(body);
  rejectUnknown(
    object,
    new Set([
      "forecast_run_id",
      "scenario_id",
      "optimizer_policy_id",
      "provider",
      "instrument",
      "price_table_version_ids",
    ]),
  );
  if (object.forecast_run_id === undefined || object.optimizer_policy_id === undefined) {
    throw invalid();
  }
  const provider = object.provider === undefined ? "aws" : providerValue(object.provider);
  const instrument =
    object.instrument === undefined
      ? "aws_compute_savings_plan"
      : instrumentValue(object.instrument);
  if (provider !== "aws" || instrument !== "aws_compute_savings_plan") throw invalid();
  return Object.freeze({
    forecastRunId: uuidValue(object.forecast_run_id),
    ...(object.scenario_id === undefined ? {} : { scenarioId: uuidValue(object.scenario_id) }),
    optimizerPolicyId: uuidValue(object.optimizer_policy_id),
    provider,
    instrument,
    ...(object.price_table_version_ids === undefined
      ? {}
      : { priceTableVersionIds: uuidArray(object.price_table_version_ids) }),
  });
}

function uuidArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw invalid();
  const ids = value.map(uuidValue);
  if (new Set(ids).size !== ids.length) throw invalid();
  return Object.freeze(ids);
}

function providerValue(value: unknown): OptimizerRunProvider {
  if (value !== "aws") throw invalid();
  return value;
}

function instrumentValue(value: unknown): OptimizerRunInstrument {
  if (value !== "aws_compute_savings_plan") throw invalid();
  return value;
}

function uuidValue(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

function closedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid();
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
