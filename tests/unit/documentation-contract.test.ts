import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const docs = [
  ["docs/price-fixtures.md", /versioned draft/iu, /price_table_version_ids/iu],
  ["docs/import-mappings.md", /AWS Cost & Usage Report/iu, /quarantined/iu],
  ["docs/risk-policy.md", /p95 downside/iu, /frozen report/iu],
  ["docs/efficient-frontier.md", /no-commitment baseline/iu, /accessible alternative/iu],
] as const;

describe("operator documentation", () => {
  it("keeps the four required product explanations present and secret-free", async () => {
    for (const [path, ...markers] of docs) {
      const content = await readFile(path, "utf8");
      for (const marker of markers) expect(content, path).toMatch(marker);
      expect(content, path).not.toMatch(/(?:BEGIN (?:RSA )?PRIVATE KEY|_API_KEY=|password\s*=)/iu);
    }
  });
});
