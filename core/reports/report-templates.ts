import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { AppError } from "../shared/errors.js";

export const RECOMMENDATION_REPORT_TEMPLATE_ID = "recommendation_report:v1";

export const RECOMMENDATION_REPORT_TOKENS = Object.freeze([
  "tenant.display_name",
  "tenant.full_legal_name",
  "tenant.contact.finance_owner_email",
  "recommendation.type",
  "recommendation.provider",
  "recommendation.instrument",
  "recommendation.term_months",
  "recommendation.commitment_amount",
  "recommendation.expected_savings",
  "recommendation.p95_downside_loss",
  "recommendation.risk_band",
  "recommendation.confidence_score",
  "frontier.baseline_name",
  "frontier.net_savings_delta",
  "constraints.binding",
  "price_table.version_label",
  "forecast.quality_summary",
] as const);

export type RecommendationReportToken = (typeof RECOMMENDATION_REPORT_TOKENS)[number];

const TEMPLATE_FILES: Readonly<Record<string, string>> = Object.freeze({
  [RECOMMENDATION_REPORT_TEMPLATE_ID]: "recommendation_report_v1.hbs",
});

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/gu;

export async function resolveReportTemplate(
  templateId: string,
  _tenantId: string,
): Promise<string> {
  const fileName = TEMPLATE_FILES[templateId];
  if (!fileName) throw templateNotFound();
  try {
    return await readFile(join(process.cwd(), "core", "reports", "templates", fileName), "utf8");
  } catch {
    throw templateNotFound();
  }
}

export function assertRecommendationReportTemplateInventory(template: string): void {
  const actual = new Set(templateTokens(template));
  const expected = new Set(RECOMMENDATION_REPORT_TOKENS);
  if (actual.size !== expected.size) throw templateInventoryInvalid();
  for (const token of expected) if (!actual.has(token)) throw templateInventoryInvalid();
}

export function renderStrictTemplate(template: string, snapshot: Record<string, unknown>): string {
  return template.replace(TOKEN_PATTERN, (_match, token: string) =>
    escapeHtml(stringToken(snapshot, token)),
  );
}

export function templateTokens(template: string): readonly string[] {
  const tokens: string[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1]!;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return Object.freeze(tokens);
}

function stringToken(snapshot: Record<string, unknown>, token: string): string {
  let value: unknown = snapshot;
  for (const segment of token.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !(segment in value)) {
      throw tokenMissing(token);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw tokenMissing(token);
}

function templateNotFound(): AppError {
  return new AppError({
    code: "REPORT_TEMPLATE_NOT_FOUND",
    message: "Report template was not found.",
    statusCode: 500,
    details: [],
  });
}

function tokenMissing(token: string): AppError {
  return new AppError({
    code: "REPORT_TEMPLATE_TOKEN_MISSING",
    message: `Report template token is missing: ${token}.`,
    statusCode: 500,
    details: [],
  });
}

function templateInventoryInvalid(): AppError {
  return new AppError({
    code: "REPORT_TEMPLATE_TOKEN_INVENTORY_INVALID",
    message: "Report template token inventory is invalid.",
    statusCode: 500,
    details: [],
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
