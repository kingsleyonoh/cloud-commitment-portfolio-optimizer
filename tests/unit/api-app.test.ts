import { describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/app";
import { loadConfig } from "../../core/shared/config";

describe("buildApp", () => {
  it("creates a Fastify instance without registering feature routes during scaffold", async () => {
    const app = buildApp({ config: loadConfig({ NODE_ENV: "test" }) });
    expect(app.hasRoute({ method: "GET", url: "/api/recommendations" })).toBe(
      false,
    );
    await app.close();
  });
});
