import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeCloudAccountsHarness,
  cloudAccountsAuthorization,
  createCloudAccountsHarness,
  insertCloudAccount,
  type CloudAccountsHarness,
} from "./helpers/cloud-accounts-app.js";

let harness: CloudAccountsHarness;

beforeAll(async () => {
  harness = await createCloudAccountsHarness("ccpo_cloud_accounts_route");
});

afterAll(async () => {
  await closeCloudAccountsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("cloud account API", () => {
  it("creates normalized cloud account metadata without leaking tenant or secrets", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/cloud-accounts",
      headers: { "content-type": "application/json", ...cloudAccountsAuthorization(harness) },
      payload: {
        provider: "aws",
        external_ref: "  AWS-ROOT-001  ",
        display_name: "  Production AWS  ",
        currency: "usd",
        tags: { environment: "prod", owner: "finops" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      provider: "aws",
      external_ref: "aws-root-001",
      display_name: "Production AWS",
      currency: "USD",
      tags: { environment: "prod", owner: "finops" },
      is_active: true,
    });
    expect(Object.keys(response.json())).toEqual([
      "id",
      "provider",
      "external_ref",
      "display_name",
      "currency",
      "tags",
      "is_active",
      "created_at",
      "updated_at",
    ]);
    expect(response.body).not.toMatch(/tenant_id|key_hash|plaintext|authorization/iu);
    const stored = await harness.pool.query<{ tenant_id: string; external_ref: string }>(
      "SELECT tenant_id, external_ref FROM cloud_accounts WHERE id = $1",
      [response.json().id],
    );
    expect(stored.rows[0]).toEqual({
      tenant_id: harness.tenantA,
      external_ref: "aws-root-001",
    });
    expect(harness.logs.find((line) => line.includes("cloud_accounts.create"))).toBeDefined();
  });

  it("rejects malformed create payloads before mutation and reports duplicate conflicts", async () => {
    const before = await tenantAccountCount(harness.tenantA);
    for (const payload of [
      {
        provider: "aws",
        external_ref: "bad-unknown",
        display_name: "Bad",
        currency: "USD",
        credential: "not accepted",
      },
      {
        provider: "aws",
        external_ref: "bad-secret",
        display_name: "Bad",
        currency: "USD",
        tags: { tokenPurpose: "denied" },
      },
      { provider: "aws", external_ref: "bad-currency", display_name: "Bad", currency: "US" },
    ]) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/cloud-accounts",
        headers: { "content-type": "application/json", ...cloudAccountsAuthorization(harness) },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: "VALIDATION_ERROR", message: "Request is invalid.", details: [] },
      });
    }
    expect(await tenantAccountCount(harness.tenantA)).toBe(before);

    await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantA,
      provider: "gcp",
      externalRef: "billing-project",
      displayName: "GCP Billing",
    });
    await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantB,
      provider: "gcp",
      externalRef: "billing-project",
      displayName: "Other Tenant GCP",
    });
    const duplicate = await harness.app.inject({
      method: "POST",
      url: "/api/cloud-accounts",
      headers: { "content-type": "application/json", ...cloudAccountsAuthorization(harness) },
      payload: {
        provider: "gcp",
        external_ref: " BILLING-PROJECT ",
        display_name: "Duplicate",
        currency: "USD",
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: {
        code: "CLOUD_ACCOUNT_CONFLICT",
        message: "A cloud account conflicts with existing metadata.",
        details: [],
      },
    });
    expect(duplicate.body).not.toMatch(/billing-project|cloud_accounts_tenant_provider/iu);
  });

  it("lists only the authenticated tenant with filters and stable cursor pagination", async () => {
    await harness.pool.query("DELETE FROM cloud_accounts");
    const expectedIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const inserted = await insertCloudAccount(harness.pool, {
        tenantId: harness.tenantA,
        provider: index % 2 === 0 ? "aws" : "azure",
        externalRef: `page-${index}`,
        displayName: `Page ${index}`,
        isActive: index !== 1,
        createdAt: `2026-01-0${index + 1}T00:00:00.000000Z`,
      });
      expectedIds.unshift(inserted.id);
    }
    await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantB,
      provider: "aws",
      externalRef: "cross-tenant-hidden",
      displayName: "Hidden",
      createdAt: "2026-01-06T00:00:00.000000Z",
    });

    const activeAws = await harness.app.inject({
      method: "GET",
      url: "/api/cloud-accounts?provider=aws&is_active=true",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(activeAws.statusCode).toBe(200);
    expect(activeAws.body).not.toContain("cross-tenant-hidden");
    expect(activeAws.json().cloud_accounts).toHaveLength(3);
    expect(
      activeAws
        .json()
        .cloud_accounts.every(
          (account: { provider: string; is_active: boolean }) =>
            account.provider === "aws" && account.is_active,
        ),
    ).toBe(true);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "2" });
      if (cursor) query.set("cursor", cursor);
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/cloud-accounts?${query}`,
        headers: cloudAccountsAuthorization(harness, "finops_analyst", "finops_analyst"),
      });
      expect(response.statusCode).toBe(200);
      const page = response.json();
      seen.push(...page.cloud_accounts.map((account: { id: string }) => account.id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(expectedIds);
  });

  it("patches with optimistic concurrency and hides cross-tenant identifiers", async () => {
    const own = await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantA,
      provider: "azure",
      externalRef: "update-me",
      displayName: "Update Me",
    });
    const other = await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantB,
      provider: "azure",
      externalRef: "other-update-me",
      displayName: "Other Update Me",
    });

    const updated = await harness.app.inject({
      method: "PATCH",
      url: `/api/cloud-accounts/${own.id}`,
      headers: {
        "content-type": "application/json",
        "x-api-key": harness.analystApiKey,
      },
      payload: {
        expected_updated_at: own.updatedAt,
        external_ref: " UPDATE-ME-NEW ",
        display_name: "  Updated Azure  ",
        currency: "eur",
        tags: { cost_center: "finops" },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      external_ref: "update-me-new",
      display_name: "Updated Azure",
      currency: "EUR",
      tags: { cost_center: "finops" },
    });

    const stale = await harness.app.inject({
      method: "PATCH",
      url: `/api/cloud-accounts/${own.id}`,
      headers: {
        "content-type": "application/json",
        ...cloudAccountsAuthorization(harness, "finops_analyst", "finops_analyst"),
      },
      payload: { expected_updated_at: own.updatedAt, display_name: "Stale" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CLOUD_ACCOUNT_VERSION_CONFLICT");

    const hidden = await harness.app.inject({
      method: "PATCH",
      url: `/api/cloud-accounts/${other.id}`,
      headers: { "content-type": "application/json", ...cloudAccountsAuthorization(harness) },
      payload: { expected_updated_at: other.updatedAt, display_name: "Should Not Update" },
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);
  });

  it("deactivates only with tenant-admin JWT and requires a reason", async () => {
    const account = await insertCloudAccount(harness.pool, {
      tenantId: harness.tenantA,
      provider: "aws",
      externalRef: "deactivate-me",
      displayName: "Deactivate Me",
    });

    for (const headers of [
      { "x-api-key": harness.analystApiKey },
      cloudAccountsAuthorization(harness, "finops_analyst", "finops_analyst"),
    ]) {
      const denied = await harness.app.inject({
        method: "POST",
        url: `/api/cloud-accounts/${account.id}/deactivate`,
        headers: { "content-type": "application/json", ...headers },
        payload: { reason: "not allowed" },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("FORBIDDEN");
    }

    const missingReason = await harness.app.inject({
      method: "POST",
      url: `/api/cloud-accounts/${account.id}/deactivate`,
      headers: { "content-type": "application/json", ...cloudAccountsAuthorization(harness) },
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);

    const deactivated = await harness.app.inject({
      method: "POST",
      url: `/api/cloud-accounts/${account.id}/deactivate`,
      headers: { "content-type": "application/json", ...cloudAccountsAuthorization(harness) },
      payload: { reason: "Retired cloud account" },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().is_active).toBe(false);

    const repeated = await harness.app.inject({
      method: "POST",
      url: `/api/cloud-accounts/${account.id}/deactivate`,
      headers: { "content-type": "application/json", ...cloudAccountsAuthorization(harness) },
      payload: { reason: "Already retired" },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().is_active).toBe(false);
  });
});

async function tenantAccountCount(tenantId: string): Promise<number> {
  const result = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM cloud_accounts WHERE tenant_id = $1",
    [tenantId],
  );
  return result.rows[0]!.count;
}
