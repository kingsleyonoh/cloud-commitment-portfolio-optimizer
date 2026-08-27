import assert from "node:assert/strict";

export function validateCoverageClass(fixtureCase) {
  const { case_id: caseId, dimensions, inputs } = fixtureCase;
  const matches = (provider, instrument, paymentOption) =>
    dimensions.provider === provider &&
    dimensions.instrument === instrument &&
    dimensions.payment_option === paymentOption;
  const requireClass = (condition) =>
    assert.ok(condition, `${caseId} does not preserve its PRD coverage class`);

  if (caseId === "aws-compute-savings-plan-partial-utilization") {
    requireClass(matches("aws", "compute_savings_plan", "no_upfront"));
    requireClass(BigInt(inputs.eligible_usage_cents) < BigInt(inputs.committed_capacity_cents));
  } else if (caseId === "aws-reserved-instance-upfront-amortization") {
    requireClass(matches("aws", "reserved_instance", "all_upfront"));
    requireClass(BigInt(inputs.upfront_cost_cents) > 0n);
  } else if (caseId === "azure-reservation-region-mismatch") {
    requireClass(matches("azure", "azure_reservation", "partial_upfront"));
    const regions = dimensions.region.split("_to_");
    requireClass(regions.length === 2 && regions[0] !== regions[1]);
  } else if (caseId === "gcp-cud-term-mismatch") {
    requireClass(matches("gcp", "gcp_cud", "not_applicable"));
    requireClass(dimensions.term_months !== inputs.term_months);
  } else if (caseId === "no-action-baseline") {
    requireClass(matches("aws", "no_action", "not_applicable"));
    requireClass(
      inputs.commitment_effective_cost_cents === "0" &&
        inputs.committed_capacity_cents === "0" &&
        inputs.upfront_cost_cents === "0",
    );
  } else {
    requireClass(false);
  }
}
