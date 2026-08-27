import { describe, expect, it } from "vitest";
import { renderErrorPage } from "../../apps/web/error-page.js";

describe("server-rendered error shell", () => {
  it("renders an accessible product-branded not-found document without client assets", () => {
    const html = renderErrorPage({ kind: "not-found", reference: "request-404" });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Page not found | Cloud Commitment Portfolio Optimizer</title>");
    expect(html).toContain("<main");
    expect(html).toContain("<h1>Page not found</h1>");
    expect(html).toContain("Cloud Commitment Portfolio Optimizer");
    expect(html).toContain("request-404");
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/(?:src|href)=["']https?:/iu);
    expect(html).not.toContain("hx-");
  });

  it("renders a generic internal-error document without exposing unknown error content", () => {
    const html = renderErrorPage({ kind: "internal-error", reference: "request-500" });

    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).toContain("request-500");
    expect(html).not.toContain("database-password");
    expect(html).not.toContain("stack");
  });
});
