import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startE2eServer, type RunningServer } from "./helpers/server.js";

interface Traffic {
  console: Array<{ type: string; text: string }>;
  requests: Array<{ method: string; url: string }>;
  responses: Array<{ status: number; url: string }>;
}

const evidenceRoot = resolve(
  process.env.APP_E2E_EVIDENCE_DIR ??
    ".pi/agents/runs/mesh-2026-07-15T04-48-42-305Z-sl3hes/artifacts/screenshots",
);
let healthy: RunningServer;
let unavailable: RunningServer;

test.beforeAll(async () => {
  test.setTimeout(35_000);
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_ADMIN_URL is required for health E2E.");
  try {
    healthy = await startE2eServer({
      target: "application",
      environment: { DATABASE_URL: databaseUrl, DB_POOL_CONNECTION_TIMEOUT_MS: "2000" },
    });
    unavailable = await startE2eServer({
      target: "application",
      environment: {
        DATABASE_URL: "postgresql://127.0.0.1:1/ccpo_unreachable",
        DB_POOL_CONNECTION_TIMEOUT_MS: "250",
      },
    });
  } catch (error) {
    if (!healthy) throw error;
    try {
      await healthy.stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Health E2E startup cleanup failed.");
    }
    throw error;
  }
});

test.afterAll(async () => {
  await Promise.all([healthy?.stop(), unavailable?.stop()]);
});

test("built health contracts remain minimal in Chromium across DB success and failure", async ({
  page,
}) => {
  const traffic = captureTraffic(page);
  const liveness = await page.goto(`${unavailable.url}/health`, { waitUntil: "networkidle" });
  expect(liveness?.status()).toBe(200);
  expect(await page.locator("body").innerText()).toBe('{"status":"ok"}');
  expect(liveness?.headers()["cache-control"]).toBe("no-store");
  expect(liveness?.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);

  const healthyDb = await page.goto(`${healthy.url}/health/db`, { waitUntil: "networkidle" });
  expect(healthyDb?.status()).toBe(200);
  expect(await page.locator("body").innerText()).toBe('{"status":"ok"}');

  const unavailableDb = await page.goto(`${unavailable.url}/health/db`, {
    waitUntil: "networkidle",
  });
  expect(unavailableDb?.status()).toBe(503);
  expect(await page.locator("body").innerText()).toBe('{"status":"unavailable"}');
  expect(unavailableDb?.headers()["cache-control"]).toBe("no-store");
  expect(await page.locator("body").innerText()).not.toMatch(/postgres|database|127\.0\.0\.1/iu);
  expect(traffic.requests.filter(({ url }) => !isExpectedOrigin(url))).toEqual([]);
  expect(unexpectedConsoleErrors(traffic)).toEqual([]);

  const screenshot = resolve(evidenceRoot, "phase1-health-db-unavailable.png");
  const summary = resolve(evidenceRoot, "phase1-health-console-network.json");
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  await writeFile(summary, `${JSON.stringify(traffic, null, 2)}\n`, "utf8");
});

function captureTraffic(page: Page): Traffic {
  const traffic: Traffic = { console: [], requests: [], responses: [] };
  page.on("console", (message) =>
    traffic.console.push({ type: message.type(), text: message.text() }),
  );
  page.on("request", (request) =>
    traffic.requests.push({ method: request.method(), url: request.url() }),
  );
  page.on("response", (response) =>
    traffic.responses.push({ status: response.status(), url: response.url() }),
  );
  return traffic;
}

function isExpectedOrigin(url: string): boolean {
  const origin = new URL(url).origin;
  return origin === new URL(healthy.url).origin || origin === new URL(unavailable.url).origin;
}

function unexpectedConsoleErrors(traffic: Traffic): Traffic["console"] {
  return traffic.console.filter(
    ({ type, text }) =>
      type === "error" && !text.includes("the server responded with a status of 503"),
  );
}
