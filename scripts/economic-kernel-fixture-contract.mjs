import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { validateCoverageClass } from "./economic-kernel-coverage-contract.mjs";

const CASE_IDS = [
  "aws-compute-savings-plan-partial-utilization",
  "aws-reserved-instance-upfront-amortization",
  "azure-reservation-region-mismatch",
  "gcp-cud-term-mismatch",
  "no-action-baseline",
];
const CASE_KEYS = [
  "case_id",
  "case_version",
  "dimensions",
  "expected",
  "inputs",
  "operation",
  "oracle",
  "units",
];
const DIMENSION_KEYS = [
  "instrument",
  "payment_option",
  "provider",
  "region",
  "tenant_reporting_currency",
  "term_months",
];
const INPUT_KEYS = [
  "commitment_effective_cost_cents",
  "committed_capacity_cents",
  "eligible_usage_cents",
  "liquidity_penalty_bps",
  "on_demand_cost_cents",
  "term_months",
  "upfront_cost_cents",
];
const ORACLE_KEYS = ["owner", "prd_ref", "status"];
const MANIFEST_KEYS = [
  "cases_file",
  "cli_contract_version",
  "economics_state",
  "fixture_contract_version",
  "formula_owner",
  "required_case_ids",
  "units",
];
const OWNER = {
  owner: "phase1-zig-economic-kernel-formulas-rounding",
  prd_ref: "5.5",
  status: "deferred_to_formula_item",
};

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
}

export function validateCorpusBytes({ manifestBytes, casesBytes }) {
  const manifestText = strictText(manifestBytes, "manifest");
  const manifest = parseCanonical(manifestText.slice(0, -1), "manifest");
  validateManifest(manifest);
  const casesText = strictText(casesBytes, "cases");
  const lines = casesText.slice(0, -1).split("\n");
  assert.ok(lines.every(Boolean), "cases must not contain blank lines");
  const cases = lines.map((line, index) => parseCanonical(line, `case line ${index + 1}`));
  cases.forEach(validateCase);
  const ids = cases.map((fixtureCase) => fixtureCase.case_id);
  assert.deepEqual(ids, [...ids].sort(), "case IDs must be sorted");
  assert.equal(new Set(ids).size, ids.length, "duplicate case IDs are forbidden");
  assert.deepEqual(ids, manifest.required_case_ids, "case IDs must match the manifest");
  return { cases, manifest };
}

export async function loadAndValidateCorpus(directory) {
  const [manifestBytes, casesBytes] = await Promise.all([
    readFile(join(directory, "manifest.v1.json")),
    readFile(join(directory, "cases.v1.ndjson")),
  ]);
  return validateCorpusBytes({ manifestBytes, casesBytes });
}

function strictText(bytes, label) {
  assert.ok(Buffer.isBuffer(bytes), `${label} must be bytes`);
  assert.ok(bytes.length > 1 && bytes.at(-1) === 10, `${label} must end in one LF`);
  assert.notEqual(bytes.at(-2), 10, `${label} must end in exactly one LF`);
  assert.equal(bytes.includes(13), false, `${label} must not contain CR`);
  assert.equal(
    bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    false,
    `${label} must not contain BOM`,
  );
  const text = bytes.toString("utf8");
  assert.ok(Buffer.from(text).equals(bytes), `${label} must be valid UTF-8`);
  return text;
}

function parseCanonical(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    assert.fail(`${label} must contain valid JSON`);
  }
  assert.equal(`${canonicalStringify(value)}`, text, `${label} must use canonical JSON`);
  rejectNumbers(value, label);
  rejectAmbiguity(value, label);
  return value;
}

function rejectNumbers(value, path) {
  assert.notEqual(
    typeof value,
    "number",
    `${path} JSON numbers are forbidden; use decimal strings`,
  );
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) rejectNumbers(child, `${path}.${key}`);
  }
}

function rejectAmbiguity(value, path) {
  if (typeof value === "string")
    assert.doesNotMatch(
      value,
      /\b(?:TODO|TBD|FIXME|placeholder|unknown)\b/iu,
      `${path} contains ambiguous text`,
    );
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) rejectAmbiguity(child, `${path}.${key}`);
  }
}

function validateManifest(manifest) {
  exactKeys(manifest, MANIFEST_KEYS, "manifest");
  assert.equal(manifest.cases_file, "cases.v1.ndjson");
  assert.equal(manifest.cli_contract_version, "economic-kernel-cli/v1");
  assert.equal(manifest.economics_state, "not_implemented");
  assert.equal(manifest.fixture_contract_version, "economic-kernel-fixtures/v1");
  assert.deepEqual(manifest.formula_owner, OWNER);
  assert.deepEqual(manifest.required_case_ids, CASE_IDS);
  assert.deepEqual(manifest.units, [
    "basis_points",
    "count",
    "tenant_reporting_currency_minor_unit",
  ]);
}

function validateCase(fixtureCase) {
  exactKeys(fixtureCase, CASE_KEYS, `case ${fixtureCase.case_id}`);
  assert.match(fixtureCase.case_id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.equal(fixtureCase.case_version, "economic-kernel-case/v1");
  assert.equal(fixtureCase.expected, null, `${fixtureCase.case_id} expected must remain null`);
  assert.equal(fixtureCase.operation, "evaluate");
  exactKeys(fixtureCase.oracle, ORACLE_KEYS, "oracle");
  assert.deepEqual(fixtureCase.oracle, OWNER, `${fixtureCase.case_id} oracle must be explicit`);
  validateDimensions(fixtureCase.dimensions);
  validateInputs(fixtureCase.inputs);
  validateUnits(fixtureCase.units);
  validateCoverageClass(fixtureCase);
}

function validateDimensions(dimensions) {
  exactKeys(dimensions, DIMENSION_KEYS, "dimensions");
  assert.ok(
    [
      "compute_savings_plan",
      "reserved_instance",
      "azure_reservation",
      "gcp_cud",
      "no_action",
    ].includes(dimensions.instrument),
  );
  assert.ok(
    ["all_upfront", "no_upfront", "partial_upfront", "not_applicable"].includes(
      dimensions.payment_option,
    ),
  );
  assert.ok(["aws", "azure", "gcp"].includes(dimensions.provider));
  assert.match(dimensions.region, /^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
  assert.match(dimensions.tenant_reporting_currency, /^[A-Z]{3}$/u);
  decimalString(dimensions.term_months, true);
}

function validateInputs(inputs) {
  exactKeys(inputs, INPUT_KEYS, "inputs");
  for (const key of INPUT_KEYS) decimalString(inputs[key], key === "term_months");
}

function validateUnits(units) {
  exactKeys(units, INPUT_KEYS, "units");
  for (const key of INPUT_KEYS) {
    const expected =
      key === "liquidity_penalty_bps"
        ? "basis_points"
        : key === "term_months"
          ? "count"
          : "tenant_reporting_currency_minor_unit";
    assert.equal(units[key], expected, `${key} has a disallowed unit`);
  }
}

function decimalString(value, positive) {
  assert.equal(typeof value, "string", "numeric inputs must be strings");
  assert.match(
    value,
    /^(?:0|[1-9][0-9]*)$/u,
    "numeric strings must be canonical non-negative integers",
  );
  if (positive) assert.notEqual(value, "0", "count must be positive");
}

function exactKeys(value, expected, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  assert.deepEqual(Object.keys(value), expected, `${label} fields must be exact and canonical`);
}
