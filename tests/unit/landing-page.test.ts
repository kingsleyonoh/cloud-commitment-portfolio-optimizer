import { describe, expect, it } from "vitest";

import { renderLandingPage } from "../../apps/web/landing-page.js";

describe("landing page", () => {
  it("covers the product overview contract without client code or external assets", () => {
    const html = renderLandingPage();

    expect(html).toContain("Buy cloud commitments like a portfolio, not a spreadsheet guess.");
    expect(html).toContain("Run a 12-month replay");
    expect(html).toContain("deterministic replay");
    expect(html).toContain("frozen price version");
    expect(html).toContain("Optional integrations");
    expect(html).toContain("support sharing is a deliberate choice");
    expect(html).toMatch(/name="description"/iu);
    expect(html).toMatch(/name="keywords"/iu);
    expect(html).toMatch(/href="\/login"/gu);
    expect(html).not.toMatch(/<script\b|(?:src|href)=['"]https?:/iu);
  });
});
