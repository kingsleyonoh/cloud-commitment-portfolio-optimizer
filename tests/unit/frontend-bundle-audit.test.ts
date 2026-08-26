import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webDirectory = fileURLToPath(new URL("../../apps/web/", import.meta.url));

describe("frontend bundle contract", () => {
  it("keeps the dashboard server-rendered and free of charting payloads", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    expect(Object.keys(dependencies)).not.toEqual(
      expect.arrayContaining(["chart.js", "recharts", "plotly.js", "parquet-wasm"]),
    );
    const files = await readdir(webDirectory);
    for (const file of files.filter((name) => name.endsWith(".ts"))) {
      const source = await readFile(join(webDirectory, file), "utf8");
      expect(source, file).not.toMatch(/<script\b|(?:src|href)=['"]https?:/iu);
    }
  });

  it("keeps the table alternative explicit where a frontier or approval is reviewed", async () => {
    const [approval, dashboard] = await Promise.all([
      readFile(join(webDirectory, "approvals-page.ts"), "utf8"),
      readFile(join(webDirectory, "dashboard-page.ts"), "utf8"),
    ]);
    expect(approval).toMatch(/<table[\s\S]*<caption>/iu);
    expect(approval).toMatch(/min-height:44px/iu);
    expect(dashboard).toMatch(/<table[\s\S]*p95 downside/iu);
  });
});
