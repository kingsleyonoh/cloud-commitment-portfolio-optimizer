import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeCloudAccountsHarness,
  cloudAccountsAuthorization,
  createCloudAccountsHarness,
  insertCloudAccount,
  type CloudAccountsHarness,
} from "./helpers/cloud-accounts-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: CloudAccountsHarness;

beforeAll(async () => {
  harness = await createCloudAccountsHarness("ccpo_accounts_ui");
});

afterAll(async () => {
  await closeCloudAccountsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/accounts UI", () => {
  it("renders tenant cloud accounts with masked external references and admin management copy", async () => {
    await harness.pool.query("DELETE FROM cloud_accounts");
    await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantA,
      provider: "aws",
      externalRef: "aws-production-123456789012",
      displayName: "Production AWS",
      tags: { environment: "prod" },
    });
    await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantB,
      provider: "aws",
      externalRef: "hidden-cross-tenant-account",
      displayName: "Hidden account",
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/accounts",
      headers: { accept: "text/html", ...cloudAccountsAuthorization(harness) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>Cloud accounts | Cloud Commitment Portfolio Optimizer</title>",
    );
    expect(response.body).toContain("Production AWS");
    expect(response.body).toContain("aws");
    expect(response.body).toContain("••••9012");
    expect(response.body).toContain("Tenant Admin management");
    expect(response.body).toContain("Provider");
    expect(response.body).not.toContain("aws-production-123456789012");
    expect(response.body).not.toContain("hidden-cross-tenant-account");
    expect(response.body).not.toMatch(/<script|key_hash|password|authorization|Bearer/iu);
  });

  it("renders a read-only management boundary for non-admin roles", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/accounts",
      headers: {
        accept: "text/html",
        ...cloudAccountsAuthorization(harness, "finops_analyst", "finops_analyst"),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Read-only access");
    expect(response.body).not.toContain("Tenant Admin management");
  });

  it("requires authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/accounts",
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/(?:external_ref|key_hash|password|token|stack|postgres)/iu);
  });
});
