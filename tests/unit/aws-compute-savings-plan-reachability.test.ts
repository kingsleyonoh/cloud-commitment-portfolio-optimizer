import { expect, it } from "vitest";

import { parseAwsComputeSavingsPlanPriceTable } from "../../core/price-tables/price-tables-input.js";
import {
  optimizeAwsComputeSavingsPlan,
  type AwsComputeSavingsPlanCandidate,
} from "../../core/optimizer-runs/optimizer-worker.js";
import type { OptimizerWorkerRun } from "../../core/optimizer-runs/optimizer-runs-types.js";

const run: OptimizerWorkerRun = Object.freeze({
  id: "018c4d40-0000-7000-8000-000000000001",
  tenantId: "018c4d40-0000-7000-8000-000000000002",
  forecastRunId: "018c4d40-0000-7000-8000-000000000003",
  scenarioId: null,
  optimizerPolicyId: "018c4d40-0000-7000-8000-000000000004",
  provider: "aws",
  instrument: "aws_compute_savings_plan",
  priceTableVersionIds: ["018c4d40-0000-7000-8000-000000000005"],
  status: "running",
  randomSeed: "20260826",
  inputSnapshotUri: "optimizer-runs/run/input.json",
  outputUri: null,
  frontierUri: null,
  infeasibilityDetails: {},
  errorDetails: {},
  createdByUserId: "018c4d40-0000-7000-8000-000000000006",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
});

it("exposes and exercises the PRD AWS Compute Savings Plan price-table parser seam", () => {
  const parsed = parseAwsComputeSavingsPlanPriceTable({
    provider: "aws",
    instrument: "aws_compute_savings_plan",
    version_label: "AWS CSP 2026",
    effective_from: "2026-08-01",
    effective_to: null,
    source_uri: "prices/aws/csp-2026.json",
    items: [
      {
        sku: "csp-us-east-1-1y",
        region: "us-east-1",
        term_months: 12,
        payment_option: "no_upfront",
        hourly_rate_cents: "6800",
        upfront_cents: "0",
        coverage_rules: { service_code: "AmazonEC2", usage_family: "compute" },
      },
    ],
  });

  expect(parsed).toMatchObject({
    provider: "aws",
    instrument: "aws_compute_savings_plan",
    versionLabel: "AWS CSP 2026",
    sourceUri: "prices/aws/csp-2026.json",
  });
  expect(parsed.checksum).toMatch(/^[a-f0-9]{64}$/u);
});

it("exposes and exercises the PRD AWS Compute Savings Plan optimizer seam", () => {
  const candidates = optimizeAwsComputeSavingsPlan(
    run,
    {
      policy: {
        maxDownsideLossCents: "250000",
        minExpectedSavingsCents: "1000",
        maxUtilizationGapPct: "40.00",
        approvalThresholdCents: "10000000",
        config: { liquidity_penalty_bps: 0 },
      },
      forecast_run: { outputUri: "forecast-runs/run/output.json" },
    },
    {
      forecast_points: [
        {
          month: "2026-09",
          provider: "aws",
          service_code: "AmazonEC2",
          region: "us-east-1",
          forecast_on_demand_cost_cents: "600000",
        },
        {
          month: "2026-10",
          provider: "aws",
          service_code: "AmazonEC2",
          region: "us-east-1",
          forecast_on_demand_cost_cents: "610000",
        },
      ],
    },
    [
      {
        sku: "csp-us-east-1-1y",
        region: "us-east-1",
        termMonths: 12,
        paymentOption: "no_upfront",
        hourlyRateCents: "600",
        upfrontCents: "0",
        coverageRules: { service_code: "AmazonEC2", usage_family: "compute" },
      },
    ],
  );

  expect(candidates).toHaveLength(1);
  const [candidate] = candidates as readonly AwsComputeSavingsPlanCandidate[];
  expect(candidate).toMatchObject({
    provider: "aws",
    instrument: "aws_compute_savings_plan",
    service_code: "AmazonEC2",
    region: "us-east-1",
    term_months: 12,
    payment_option: "no_upfront",
    feasible: true,
    binding_constraints: [],
  });
  expect(BigInt(candidate!.expected_savings_cents)).toBeGreaterThan(0n);
});
