import { connect } from "node:net";
import { afterEach, expect, it } from "vitest";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeRegistrationHarness,
  createRegistrationHarness,
  runtimeIdempotencyKey,
  type RegistrationHarness,
} from "./helpers/registration-app.js";

let harness: RegistrationHarness | undefined;

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeRegistrationHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("rejects duplicate Idempotency-Key lines over a real TCP HTTP connection", async () => {
  harness = await createRegistrationHarness("ccpo_registration_duplicate_header");
  await harness.app.listen({ host: "127.0.0.1", port: 0 });
  const address = harness.app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  const response = await rawRequest(address.port);

  expect(response.statusLine).toContain(" 400 ");
  expect(JSON.parse(response.body).error.code).toBe("VALIDATION_ERROR");
  expect(
    (await harness.pool.query("SELECT count(*)::int AS count FROM registration_requests")).rows[0]
      ?.count,
  ).toBe(0);
});

function rawRequest(port: number): Promise<{ statusLine: string; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: "Duplicate Header Tenant" });
    const lines = [
      "POST /api/tenants/register HTTP/1.1",
      "Host: 127.0.0.1",
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      `Idempotency-Key: ${runtimeIdempotencyKey()}`,
      `Idempotency-Key: ${runtimeIdempotencyKey()}`,
      "Connection: close",
      "",
      body,
    ];
    const socket = connect(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(lines.join("\r\n")));
    socket.on("data", (chunk) => (response += chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      const boundary = response.indexOf("\r\n\r\n");
      const headers = response.slice(0, boundary);
      resolve({ statusLine: headers.split("\r\n")[0] ?? "", body: response.slice(boundary + 4) });
    });
  });
}
