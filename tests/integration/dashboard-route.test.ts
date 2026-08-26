import { afterEach, expect, it } from "vitest";

import {
  closeAuthSessionHarness,
  createAuthSessionHarness,
  login,
  responseCookies,
  type AuthSessionHarness,
} from "./helpers/auth-session-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: AuthSessionHarness | undefined;

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeAuthSessionHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("renders protected dashboard triage from the authenticated tenant context", async () => {
  harness = await createAuthSessionHarness("ccpo_dashboard");
  await harness.pool.query(
    `INSERT INTO import_batches
       (tenant_id, source, format, status, object_uri, schema_version, line_count, error_details)
     VALUES
       ($1, 'synthetic', 'csv', 'completed', 'imports/completed.csv', 'usage-line-items:v1', 12, '{}'::jsonb),
       ($1, 'aws_cur', 'csv', 'quarantined', 'imports/quarantined.csv', 'usage-line-items:v1', 3,
        '{"reason":"control_total_mismatch"}'::jsonb)`,
    [harness.tenantId],
  );
  const session = await login(harness);
  const response = await harness.app.inject({
    method: "GET",
    url: "/dashboard",
    headers: { accept: "text/html" },
    cookies: responseCookies(session),
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("text/html");
  expect(response.body).toContain(
    "<title>Dashboard | Cloud Commitment Portfolio Optimizer</title>",
  );
  expect(response.body).toContain("ccpo_dashboard primary");
  expect(response.body).toContain("finops_analyst");
  expect(response.body).toContain("Import health");
  expect(response.body).toContain("completed");
  expect(response.body).toContain("quarantined");
  expect(response.body).toContain("Recommendation status");
  expect(response.body).toContain("No recommendations yet");
  expect(response.body).toContain("Risk rail");
  expect(response.body).not.toMatch(/<script|ccpo_access|ccpo_refresh|key_hash|password|Bearer/iu);
});

it("requires a valid browser session for dashboard access", async () => {
  harness = await createAuthSessionHarness("ccpo_dashboard_auth");
  const response = await harness.app.inject({
    method: "GET",
    url: "/dashboard",
    headers: { accept: "text/html" },
  });

  expect(response.statusCode).toBe(401);
  expect(response.body).not.toMatch(/(?:tenant_id|key_hash|password|token|stack|postgres)/iu);
});
