import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { createLocalProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: UsersHarness | undefined;

function passwordValue(): string {
  return Array.from({ length: 18 }, (_, index) => String.fromCodePoint(0x61 + (index % 24))).join(
    "",
  );
}

async function request(baseUrl: string, target: string, headers: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/users/${target}/credentials/password`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ password: passwordValue() }),
  });
  const body = (await response.json()) as { error: { code: string } };
  return {
    status: response.status,
    code: body.error.code,
    retryAfter: response.headers.get("retry-after"),
    containsInput: JSON.stringify(body).includes(passwordValue()),
  };
}

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeUsersHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("returns the safe remaining Retry-After delay over an actual HTTP listener", async () => {
  let now = 1_000_000;
  harness = await createUsersHarness(
    "ccpo_password_safe_http",
    async () => "not-persisted",
    createLocalProtectedUsersLimiter({ clock: () => now }),
  );
  const baseUrl = await harness.app.listen({ host: "127.0.0.1", port: 0 });
  const target = randomUUID();
  const admin = usersAuthorization(harness);

  expect(await request(baseUrl, target, {})).toMatchObject({
    status: 401,
    code: "AUTH_REQUIRED",
    containsInput: false,
  });
  expect(await request(baseUrl, target, { "x-api-key": harness.analystApiKey })).toMatchObject({
    status: 403,
    code: "FORBIDDEN",
    containsInput: false,
  });
  for (let index = 0; index < 5; index += 1) {
    expect(await request(baseUrl, target, admin)).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      containsInput: false,
    });
  }
  now += 2_001;
  expect(await request(baseUrl, target, admin)).toMatchObject({
    status: 429,
    code: "RATE_LIMITED",
    retryAfter: "58",
    containsInput: false,
  });
});
