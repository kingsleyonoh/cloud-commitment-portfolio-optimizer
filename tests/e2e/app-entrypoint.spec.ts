import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { startE2eServer, type RunningServer } from "./helpers/server.js";

interface Traffic {
  console: Array<{ type: string; text: string }>;
  requests: Array<{ method: string; url: string }>;
  responses: Array<{ status: number; url: string }>;
}

let server: RunningServer;

test.beforeAll(async () => {
  server = await startE2eServer({ target: "application", startupTimeoutMs: 15_000 });
});

test.afterAll(async () => {
  await server?.stop();
});

test("built application hides disabled self-registration without secret-bearing traffic", async ({
  request,
}) => {
  const response = await request.post(`${server.url}/api/tenants/register`, {
    headers: { "content-type": "application/json" },
    data: {},
  });
  const result = {
    status: response.status(),
    cacheControl: response.headers()["cache-control"],
    body: await response.json(),
  };

  expect(result).toEqual({
    status: 404,
    cacheControl: "no-store",
    body: {
      error: { code: "REGISTRATION_DISABLED", message: "Resource not found.", details: [] },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/(?:apiKey|key_hash|sha256)/u);
});

test("built application users route returns safe 401 without credential material", async ({
  request,
}) => {
  const response = await request.get(`${server.url}/api/users`);
  const result = {
    status: response.status(),
    cacheControl: response.headers()["cache-control"],
    body: await response.json(),
  };

  expect(result).toEqual({
    status: 401,
    cacheControl: "no-store",
    body: {
      error: { code: "AUTH_REQUIRED", message: "Authentication is required.", details: [] },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/(?:authorization|bearer|apiKey|key_hash|token)/iu);
});

test("built application root is an accessible script-free product 404", async ({
  page,
}, testInfo) => {
  const traffic = captureTraffic(page);
  const response = await page.goto(server.url, { waitUntil: "networkidle" });

  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found | Cloud Commitment Portfolio Optimizer");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);
  await expect(page.locator("[hx-get], [hx-post], [hx-boost]")).toHaveCount(0);
  expect(unexpectedConsoleErrors(traffic)).toEqual([]);
  expect(traffic.requests.filter(({ url }) => !sameOrigin(url, server.url))).toEqual([]);

  await writeEvidence(page, testInfo, traffic);
});

function captureTraffic(page: Page): Traffic {
  const traffic: Traffic = { console: [], requests: [], responses: [] };
  page.on("console", (message) => {
    traffic.console.push({ type: message.type(), text: message.text() });
  });
  page.on("request", (request) => {
    traffic.requests.push({ method: request.method(), url: request.url() });
  });
  page.on("response", (response) => {
    traffic.responses.push({ status: response.status(), url: response.url() });
  });
  return traffic;
}

async function writeEvidence(page: Page, testInfo: TestInfo, traffic: Traffic): Promise<void> {
  const root = resolve(process.env.APP_E2E_EVIDENCE_DIR ?? ".tmp/playwright-evidence/app");
  const screenshot = resolve(root, "app-root-404.png");
  const summary = resolve(root, "console-network.json");
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  await writeFile(
    summary,
    `${JSON.stringify(
      {
        expectedDocumentStatus: 404,
        baseUrl: server.url,
        externalRequests: traffic.requests.filter(({ url }) => !sameOrigin(url, server.url)),
        ...traffic,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await testInfo.attach("built-app-404", { path: screenshot, contentType: "image/png" });
}

function unexpectedConsoleErrors(traffic: Traffic): Traffic["console"] {
  return traffic.console.filter(({ type, text }) => {
    if (type !== "error") return false;
    return !text.includes("the server responded with a status of 404 (Not Found)");
  });
}

function sameOrigin(left: string, right: string): boolean {
  return new URL(left).origin === new URL(right).origin;
}
