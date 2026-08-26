import { describe, expect, it } from "vitest";

import { PROTECTED_ENDPOINT_ACTIONS } from "../../core/tenant/protected-route-actions.js";
import {
  parseAwsComputeSavingsPlanPriceTable,
  parseAwsReservedInstancePriceTable,
  parseAzureReservationPriceTable,
  parseAzureSavingsPlanPriceTable,
  parseGcpCommittedUseDiscountPriceTable,
} from "../../core/price-tables/price-tables-input.js";
import {
  optimizeAwsComputeSavingsPlan,
  optimizeAwsReservedInstance,
  optimizeAzureReservation,
  optimizeAzureSavingsPlan,
  optimizeGcpCommittedUseDiscount,
} from "../../core/optimizer-runs/optimizer-worker.js";

describe("Phase 2 matrix close-out", () => {
  it("has a concrete parser and optimizer seam for every P1/P2 instrument", () => {
    expect(
      [
        parseAwsComputeSavingsPlanPriceTable,
        parseAwsReservedInstancePriceTable,
        parseAzureSavingsPlanPriceTable,
        parseAzureReservationPriceTable,
        parseGcpCommittedUseDiscountPriceTable,
      ].every((seam) => typeof seam === "function"),
    ).toBe(true);
    expect(
      [
        optimizeAwsComputeSavingsPlan,
        optimizeAwsReservedInstance,
        optimizeAzureSavingsPlan,
        optimizeAzureReservation,
        optimizeGcpCommittedUseDiscount,
      ].every((seam) => typeof seam === "function"),
    ).toBe(true);
  });

  it("keeps all protected endpoint actions registered exactly once", () => {
    const keys = PROTECTED_ENDPOINT_ACTIONS.map(({ method, path }) => `${method} ${path}`);
    expect(keys.length).toBeGreaterThan(40);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("POST /api/recommendations/{id}/request-approval");
    expect(keys).toContain("POST /api/backtests");
    expect(keys).not.toContain("GET /health");
  });
});
