import { describe, expect, it } from "vitest";

import {
  assertRecommendationReportTemplateInventory,
  RECOMMENDATION_REPORT_TEMPLATE_ID,
  RECOMMENDATION_REPORT_TOKENS,
  renderStrictTemplate,
  resolveReportTemplate,
  templateTokens,
} from "../../core/reports/report-templates.js";

describe("recommendation report template contract", () => {
  it("resolves the bundled recommendation report template with the exact PRD token inventory", async () => {
    const template = await resolveReportTemplate(
      RECOMMENDATION_REPORT_TEMPLATE_ID,
      "018c4d40-0000-7000-8000-000000000001",
    );

    expect([...templateTokens(template)].sort()).toEqual([...RECOMMENDATION_REPORT_TOKENS].sort());
    expect(() => assertRecommendationReportTemplateInventory(template)).not.toThrow();
  });

  it("fails closed for missing templates and missing strict tokens", async () => {
    await expect(
      resolveReportTemplate("missing_report:v1", "018c4d40-0000-7000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "REPORT_TEMPLATE_NOT_FOUND" });

    expect(() =>
      renderStrictTemplate("{{tenant.display_name}} {{recommendation.expected_savings}}", {
        tenant: { display_name: "Acme" },
        recommendation: {},
      }),
    ).toThrowError(/recommendation\.expected_savings/u);
  });

  it("renders nullable known tokens as empty strings and escapes untrusted values", () => {
    const rendered = renderStrictTemplate(
      "{{tenant.display_name}} {{tenant.contact.finance_owner_email}}",
      {
        tenant: {
          display_name: "<Acme>",
          contact: { finance_owner_email: null },
        },
      },
    );

    expect(rendered).toBe("&lt;Acme&gt; ");
  });
});
