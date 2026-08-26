import { describe, expect, it } from "vitest";

import type { ReportsRepository } from "../../core/reports/reports-repository.js";
import { createReportsService } from "../../core/reports/reports-service.js";
import type { RecommendationReportData } from "../../core/reports/reports-types.js";
import { AppError } from "../../core/shared/errors.js";
import type { ObjectStore } from "../../core/shared/objectStore.js";
import { createUserRequestContext } from "../../core/tenant/request-context.js";

describe("reports service", () => {
  it("marks a queued recommendation report snapshot failed when strict template lookup fails", async () => {
    const markedFailed: string[] = [];
    const service = createReportsService(fakeRepository(markedFailed), memoryObjectStore(), {
      resolveTemplate: async () => {
        throw new AppError({
          code: "REPORT_TEMPLATE_NOT_FOUND",
          message: "Report template was not found.",
          statusCode: 500,
          details: [],
        });
      },
    });

    await expect(
      service.get(
        createUserRequestContext({
          tenantId: "018c4d40-0000-7000-8000-000000000001",
          actorUserId: "018c4d40-0000-4000-8000-000000000002",
          role: "tenant_admin",
          requestId: "req-report-failure",
        }),
        "recommendation",
        "018c4d40-0000-4000-8000-000000000003",
      ),
    ).rejects.toMatchObject({ code: "REPORT_TEMPLATE_NOT_FOUND" });
    expect(markedFailed).toEqual(["018c4d40-0000-4000-8000-000000000004"]);
  });
});

function fakeRepository(markedFailed: string[]): ReportsRepository {
  return {
    getRenderedReport: async () => null,
    recommendationReportData: async () => recommendationReportData,
    createQueuedRecommendationReport: async (_tenantId, recommendationId, snapshot) => ({
      id: "018c4d40-0000-4000-8000-000000000004",
      sourceType: "recommendation",
      sourceId: recommendationId,
      snapshotJson: snapshot,
      status: "queued",
      renderedHtmlUri: null,
      renderedPdfUri: null,
      createdAt: "2026-08-26T00:00:00.000000Z",
      updatedAt: "2026-08-26T00:00:00.000000Z",
    }),
    markRendered: async () => {
      throw new Error("unexpected render success");
    },
    markFailed: async (id) => {
      markedFailed.push(id);
      return {
        id,
        sourceType: "recommendation",
        sourceId: "018c4d40-0000-4000-8000-000000000003",
        snapshotJson: {},
        status: "failed",
        renderedHtmlUri: null,
        renderedPdfUri: null,
        createdAt: "2026-08-26T00:00:00.000000Z",
        updatedAt: "2026-08-26T00:00:00.000000Z",
      };
    },
  };
}

function memoryObjectStore(): ObjectStore {
  return {
    put: async () => undefined,
    get: async () => Buffer.from("{}\n", "utf8"),
    delete: async () => undefined,
    health: async () => ({ ready: true }),
    close: async () => undefined,
  };
}

const recommendationReportData: RecommendationReportData = {
  tenant: {
    displayName: "Acme",
    fullLegalName: "Acme Corp",
    contactEmail: null,
    contactPhone: null,
    supportUrl: null,
    financeOwnerEmail: null,
  },
  recommendation: {
    id: "018c4d40-0000-4000-8000-000000000003",
    recommendationType: "buy",
    provider: "aws",
    instrument: "aws_compute_savings_plan",
    termMonths: 12,
    commitmentAmountCents: "1000",
    expectedSavingsCents: "100",
    p95DownsideLossCents: "0",
    riskBand: "low",
    confidenceScore: "0.9000",
  },
  optimizerRun: {
    id: "018c4d40-0000-4000-8000-000000000005",
    frontierUri: "optimizer-runs/run/frontier.json",
  },
  priceTable: { versionLabel: "prices" },
  forecast: { qualitySummary: "confidence:high" },
};
