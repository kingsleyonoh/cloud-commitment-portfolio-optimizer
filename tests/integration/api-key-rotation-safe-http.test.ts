import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import {
  closeRotationHarness,
  createRotationHarness,
  rotationAuthorization,
  type RotationHarness,
} from "./helpers/api-key-rotation-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: RotationHarness | undefined;

afterEach(async () => {
  const database = harness?.database;
  await closeRotationHarness(harness);
  await dropIsolatedDatabase(database);
  harness = undefined;
});

async function request(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<{ status: number; code: string; retryAfter: string | null }> {
  const response = await fetch(`${baseUrl}/api/api-keys/rotate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ api_key_id: randomUUID() }),
  });
  const body = (await response.json()) as { error: { code: string } };
  return {
    status: response.status,
    code: body.error.code,
    retryAfter: response.headers.get("retry-after"),
  };
}

it("proves only safe 401/403/404/429 outcomes over an actual TCP HTTP listener", async () => {
  harness = await createRotationHarness("ccpo_rotation_safe_http");
  const address = await harness.app.listen({ host: "127.0.0.1", port: 0 });
  const admin = rotationAuthorization(harness);

  expect(await request(address, {})).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  expect(await request(address, { "x-api-key": harness.analystApiKey })).toMatchObject({
    status: 403,
    code: "FORBIDDEN",
  });
  for (let count = 0; count < 5; count += 1) {
    expect(await request(address, admin)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  }
  expect(await request(address, admin)).toMatchObject({
    status: 429,
    code: "RATE_LIMITED",
    retryAfter: "60",
  });
});
