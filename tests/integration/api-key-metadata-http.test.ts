import { afterAll, beforeAll, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  apiKeyMetadataAuthorization,
  closeApiKeyMetadataHarness,
  createApiKeyMetadataHarness,
  type ApiKeyMetadataHarness,
} from "./helpers/api-key-metadata-app.js";

let harness: ApiKeyMetadataHarness;
let baseUrl: string;

beforeAll(async () => {
  harness = await createApiKeyMetadataHarness("ccpo_api_key_metadata_http");
  await harness.pool.query("DELETE FROM registration_requests");
  await harness.pool.query("DELETE FROM api_keys WHERE tenant_id = $1", [harness.tenantA]);
  baseUrl = await harness.app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await closeApiKeyMetadataHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

it("proves safe missing, denied, and empty metadata responses over actual loopback HTTP", async () => {
  const missing = await fetch(`${baseUrl}/api/api-keys`);
  const denied = await fetch(`${baseUrl}/api/api-keys`, {
    headers: apiKeyMetadataAuthorization(harness, "finops_analyst", "finops_analyst"),
  });
  const empty = await fetch(`${baseUrl}/api/api-keys`, {
    headers: apiKeyMetadataAuthorization(harness),
  });

  expect([missing.status, denied.status, empty.status]).toEqual([401, 403, 200]);
  expect(await missing.json()).toEqual({
    error: { code: "AUTH_REQUIRED", message: "Authentication is required.", details: [] },
  });
  expect(await denied.json()).toEqual({
    error: {
      code: "FORBIDDEN",
      message: "The requested action is not permitted.",
      details: [],
    },
  });
  expect(await empty.json()).toEqual({ api_keys: [], next_cursor: null });
});
