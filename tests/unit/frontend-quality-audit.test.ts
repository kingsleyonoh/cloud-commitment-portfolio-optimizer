import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webDirectory = fileURLToPath(new URL("../../apps/web/", import.meta.url));

describe("frontend quality contract", () => {
  it("keeps server-rendered screens script-free and responsive", async () => {
    const files = (await readdir(webDirectory)).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = await readFile(join(webDirectory, file), "utf8");
      expect(source, file).not.toMatch(/<script\b|on(?:click|change|submit)\s*=/iu);
      expect(source, file).toMatch(/viewport/iu);
      expect(source, file).toMatch(/@media/iu);
      expect(source, file).not.toMatch(/innerHTML|outerHTML/iu);
    }
  });

  it("keeps approval controls keyboard-sized and risk semantics explicit", async () => {
    const approvalPage = await readFile(join(webDirectory, "approvals-page.ts"), "utf8");
    const dashboardPage = await readFile(join(webDirectory, "dashboard-page.ts"), "utf8");
    expect(approvalPage).toMatch(/min-height:44px/iu);
    expect(approvalPage).toMatch(/aria-label|aria-labelledby/iu);
    expect(approvalPage).toMatch(/Approve|Reject/iu);
    expect(dashboardPage).toContain("p95 downside");
    expect(dashboardPage).toContain("Risk rail");
  });
});
