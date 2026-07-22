import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalStringify,
  validateCorpusBytes,
} from "../../scripts/economic-kernel-fixture-contract.mjs";

const directory = "tests/fixtures/economic_kernel";

async function corpus() {
  const [manifestText, casesText] = await Promise.all([
    readFile(`${directory}/manifest.v1.json`, "utf8"),
    readFile(`${directory}/cases.v1.ndjson`, "utf8"),
  ]);
  return {
    manifest: JSON.parse(manifestText),
    cases: casesText.trimEnd().split("\n").map(JSON.parse),
  };
}

function bytes(value) {
  return {
    manifestBytes: Buffer.from(`${canonicalStringify(value.manifest)}\n`),
    casesBytes: Buffer.from(`${value.cases.map(canonicalStringify).join("\n")}\n`),
  };
}

async function reject(name, mutate, pattern = /./u) {
  await test(name, async () => {
    const value = await corpus();
    mutate(value);
    assert.throws(() => validateCorpusBytes(bytes(value)), pattern);
  });
}

for (const [name, mutate] of [
  ["manifest rejects unknown fields", ({ manifest }) => (manifest.extra = "x")],
  ["manifest rejects another cases file", ({ manifest }) => (manifest.cases_file = "other.ndjson")],
  [
    "manifest rejects another CLI contract",
    ({ manifest }) => (manifest.cli_contract_version = "v2"),
  ],
  [
    "manifest rejects implemented economics",
    ({ manifest }) => (manifest.economics_state = "implemented"),
  ],
  [
    "manifest rejects another fixture contract",
    ({ manifest }) => (manifest.fixture_contract_version = "v2"),
  ],
  [
    "manifest rejects another formula owner",
    ({ manifest }) => (manifest.formula_owner.owner = "other"),
  ],
  [
    "manifest rejects another PRD reference",
    ({ manifest }) => (manifest.formula_owner.prd_ref = "5.4"),
  ],
  [
    "manifest rejects a nondeferred formula status",
    ({ manifest }) => (manifest.formula_owner.status = "ready"),
  ],
  ["manifest rejects missing required IDs", ({ manifest }) => manifest.required_case_ids.pop()],
  ["manifest rejects ambiguous units", ({ manifest }) => (manifest.units[0] = "percent")],
  ["corpus rejects unsorted records", ({ cases }) => ([cases[0], cases[1]] = [cases[1], cases[0]])],
  ["corpus rejects duplicate records", ({ cases }) => (cases[1] = structuredClone(cases[0]))],
  ["case rejects unknown fields", ({ cases }) => (cases[0].extra = "x")],
  ["case rejects malformed IDs", ({ cases }) => (cases[0].case_id = "Bad ID")],
  ["case rejects another version", ({ cases }) => (cases[0].case_version = "v2")],
  ["case rejects computed expected values", ({ cases }) => (cases[0].expected = { net: "1" })],
  ["case rejects another operation", ({ cases }) => (cases[0].operation = "recommend")],
  ["case rejects unknown oracle fields", ({ cases }) => (cases[0].oracle.extra = "x")],
  ["case rejects another oracle owner", ({ cases }) => (cases[0].oracle.owner = "other")],
  ["case rejects another oracle PRD ref", ({ cases }) => (cases[0].oracle.prd_ref = "5.4")],
  ["case rejects another oracle status", ({ cases }) => (cases[0].oracle.status = "ready")],
  ["dimensions reject unknown fields", ({ cases }) => (cases[0].dimensions.extra = "x")],
  [
    "dimensions reject another instrument",
    ({ cases }) => (cases[0].dimensions.instrument = "spot"),
  ],
  [
    "dimensions reject another payment option",
    ({ cases }) => (cases[0].dimensions.payment_option = "monthly"),
  ],
  ["dimensions reject another provider", ({ cases }) => (cases[0].dimensions.provider = "oracle")],
  [
    "dimensions reject unsafe region text",
    ({ cases }) => (cases[0].dimensions.region = "../secret"),
  ],
  [
    "dimensions reject malformed currency",
    ({ cases }) => (cases[0].dimensions.tenant_reporting_currency = "usd"),
  ],
  ["dimensions reject zero terms", ({ cases }) => (cases[0].dimensions.term_months = "0")],
  ["inputs reject unknown fields", ({ cases }) => (cases[0].inputs.extra = "0")],
  ["inputs reject JSON numbers", ({ cases }) => (cases[0].inputs.on_demand_cost_cents = 1)],
  ["inputs reject negatives", ({ cases }) => (cases[0].inputs.on_demand_cost_cents = "-1")],
  ["inputs reject leading zeroes", ({ cases }) => (cases[0].inputs.on_demand_cost_cents = "01")],
  [
    "inputs reject decimal fractions",
    ({ cases }) => (cases[0].inputs.on_demand_cost_cents = "1.5"),
  ],
  ["inputs reject zero term counts", ({ cases }) => (cases[0].inputs.term_months = "0")],
  ["units reject unknown fields", ({ cases }) => (cases[0].units.extra = "count")],
  [
    "units reject cents as basis points",
    ({ cases }) => (cases[0].units.liquidity_penalty_bps = "tenant_reporting_currency_minor_unit"),
  ],
  ["units reject months instead of count", ({ cases }) => (cases[0].units.term_months = "months")],
  [
    "units reject count instead of cents",
    ({ cases }) => (cases[0].units.upfront_cost_cents = "count"),
  ],
  ["strings reject ambiguous placeholders", ({ cases }) => (cases[0].dimensions.region = "TBD")],
])
  await reject(name, mutate);

for (const [name, mutate] of [
  [
    "partial-utilization class rejects another allowed provider",
    ({ cases }) => (cases[0].dimensions.provider = "azure"),
  ],
  [
    "partial-utilization class requires usage below capacity",
    ({ cases }) => (cases[0].inputs.eligible_usage_cents = "1000001"),
  ],
  [
    "upfront-amortization class requires upfront cost",
    ({ cases }) => (cases[1].inputs.upfront_cost_cents = "0"),
  ],
  [
    "region-mismatch class requires distinct regions",
    ({ cases }) => (cases[2].dimensions.region = "west-europe"),
  ],
  [
    "term-mismatch class requires different terms",
    ({ cases }) => (cases[3].inputs.term_months = cases[3].dimensions.term_months),
  ],
  [
    "no-action class forbids commitment cost",
    ({ cases }) => (cases[4].inputs.commitment_effective_cost_cents = "1"),
  ],
])
  await reject(name, mutate, /class|scenario|coverage/u);

test("byte contract rejects BOM, CR, invalid UTF-8, blank lines, and missing or duplicate LF", async () => {
  const value = await corpus();
  const valid = bytes(value);
  for (const tampered of [
    {
      ...valid,
      manifestBytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid.manifestBytes]),
    },
    {
      ...valid,
      manifestBytes: Buffer.from(valid.manifestBytes.toString("utf8").replace("\n", "\r\n")),
    },
    { ...valid, manifestBytes: Buffer.from([0xc3, 0x28, 0x0a]) },
    { ...valid, casesBytes: Buffer.from(valid.casesBytes.toString("utf8").replace("\n", "\n\n")) },
    { ...valid, casesBytes: valid.casesBytes.subarray(0, valid.casesBytes.length - 1) },
    { ...valid, casesBytes: Buffer.concat([valid.casesBytes, Buffer.from("\n")]) },
  ])
    assert.throws(() => validateCorpusBytes(tampered));
});
