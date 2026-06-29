import { describe, expect, it } from "vitest";
import { loadConfig } from "../../core/shared/config";

const minimalEnv = {
  NODE_ENV: "test",
  DATABASE_URL: [
    "postgresql://",
    "test_user",
    ":",
    "test_password",
    "@localhost:5432/ccpo_test",
  ].join(""),
  REDIS_URL: "redis://localhost:6379/1",
};

describe("loadConfig", () => {
  it("loads documented local defaults without requiring optional integration secrets", () => {
    const config = loadConfig(minimalEnv);

    expect(config.app.port).toBe(8080);
    expect(config.app.publicBaseUrl).toBe("http://localhost:8080");
    expect(config.storage.duckdbTempDir).toBe(".tmp/duckdb");
    expect(config.storage.objectStoragePath).toBe(".data/objects");
    expect(config.tenant.selfRegistrationEnabled).toBe(true);
    expect(config.integrations.notificationHub.enabled).toBe(false);
    expect(config.integrations.notificationHub.apiKey).toBe("");
    expect(config.integrations.workflowEngine.enabled).toBe(false);
    expect(config.integrations.invoiceRecon.contractVerified).toBe(false);
    expect(config.optimizer.timeoutSeconds).toBe(30);
  });

  it("rejects invalid numeric and boolean environment values", () => {
    expect(() => loadConfig({ ...minimalEnv, PORT: "not-a-port" })).toThrow(
      /PORT/,
    );
    expect(() =>
      loadConfig({ ...minimalEnv, SELF_REGISTRATION_ENABLED: "sometimes" }),
    ).toThrow(/SELF_REGISTRATION_ENABLED/);
  });
});
