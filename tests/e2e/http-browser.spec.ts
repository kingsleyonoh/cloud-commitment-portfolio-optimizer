import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RunningServer } from "./helpers/server.js";
import { startE2eServer } from "./helpers/server.js";

interface BrowserTraffic {
  consoleMessages: Array<{ type: string; text: string }>;
  requests: Array<{ method: string; url: string }>;
}

let server: RunningServer;

test.beforeAll(async () => {
  server = await startE2eServer();
});

test.afterAll(async () => {
  await server.stop();
});

test("Chromium navigates over real HTTP and renders the deterministic E2E fixture", async ({
  page,
}, testInfo) => {
  const traffic = captureBrowserTraffic(page);
  const response = await page.goto(server.url);
  await assertRenderedFixture(page, response?.status(), traffic);
  await writeBrowserEvidence(page, testInfo, traffic);
});

function captureBrowserTraffic(page: Page): BrowserTraffic {
  const traffic: BrowserTraffic = { consoleMessages: [], requests: [] };
  page.on("console", (message) => {
    traffic.consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("request", (request) => {
    traffic.requests.push({ method: request.method(), url: request.url() });
  });
  return traffic;
}

async function assertRenderedFixture(
  page: Page,
  status: number | undefined,
  traffic: BrowserTraffic,
): Promise<void> {
  expect(status).toBe(200);
  await expect(page).toHaveTitle("E2E Harness Ready");
  await expect(page.getByRole("heading", { name: "E2E harness ready" })).toBeVisible();
  await expect(page.getByTestId("transport-contract")).toHaveText(
    "Real Chromium → localhost HTTP → deterministic fixture",
  );
  expect(traffic.consoleMessages.filter(({ type }) => type === "error")).toEqual([]);
  expect(traffic.requests.length).toBeGreaterThan(0);
  expect(traffic.requests.every(({ url }) => sameOrigin(url, server.url))).toBe(true);
}

async function writeBrowserEvidence(
  page: Page,
  testInfo: TestInfo,
  traffic: BrowserTraffic,
): Promise<void> {
  const screenshotPath = resolve(
    process.env.E2E_SCREENSHOT_PATH ?? ".tmp/playwright-evidence/http-browser.png",
  );
  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("passing-browser-screenshot", {
    path: screenshotPath,
    contentType: "image/png",
  });
  await writeTrafficSummary(traffic);
}

async function writeTrafficSummary(traffic: BrowserTraffic): Promise<void> {
  const summaryPath = resolve(
    process.env.E2E_CONSOLE_NETWORK_PATH ?? ".tmp/playwright-evidence/console-network.json",
  );
  const summary = {
    baseUrl: server.url,
    ...traffic,
    externalRequests: traffic.requests.filter(({ url }) => !sameOrigin(url, server.url)),
  };
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function sameOrigin(left: string, right: string): boolean {
  return new URL(left).origin === new URL(right).origin;
}
