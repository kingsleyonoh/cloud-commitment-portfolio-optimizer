import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const smokeEvidence = [
  "tests/e2e/first-run-workflow.spec.ts",
  "tests/integration/approvals-ui-route.test.ts",
  "tests/integration/recommendations-route.test.ts",
  "tests/integration/integrations-route.test.ts",
  "tests/setup/production-deployment.test.mjs",
] as const;

describe("release smoke manifest", () => {
  it("keeps setup, import, optimizer, report, approval, and disabled-adapter evidence wired", async () => {
    for (const path of smokeEvidence) await expect(access(path)).resolves.toBeUndefined();
    const workflow = await readFile(smokeEvidence[0], "utf8");
    expect(workflow).toMatch(/setup|first-run/iu);
    expect(workflow).toMatch(/synthetic|AWS CUR|optimizer|recommendation report/iu);
    const adapters = await readFile(smokeEvidence[3], "utf8");
    expect(adapters).toMatch(/disabled adapters/iu);
  });
});
