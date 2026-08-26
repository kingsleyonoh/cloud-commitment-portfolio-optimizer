import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";

import { createForecastRepository } from "../../core/forecasting/forecast-repository.js";
import { createForecastWorker } from "../../core/forecasting/forecast-worker.js";
import { createOptimizerRunsRepository } from "../../core/optimizer-runs/optimizer-runs-repository.js";
import { createOptimizerWorker } from "../../core/optimizer-runs/optimizer-worker.js";
import { createLocalObjectStore } from "../../core/shared/objectStore.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "../integration/helpers/postgres-database.js";
import { startE2eServer, type RunningServer } from "./helpers/server.js";

interface WorkflowHarness {
  database: IsolatedDatabase;
  objectRoot: string;
  passwordPath: string;
  privateKeyPath: string;
  publicKeyPath: string;
  pool: Pool;
  server: RunningServer;
  tenantId: string;
}

interface Traffic {
  console: Array<{ type: string; text: string }>;
  requests: Array<{ method: string; url: string }>;
}

interface WorkflowApi {
  origin: string;
  request: APIRequestContext;
  csrfToken: string;
}

interface RecommendationListBody extends Record<string, unknown> {
  recommendations: Array<{ id: string }>;
}

interface ReportBody extends Record<string, unknown> {
  report_snapshot: { id: string; source_type: string; status: string };
}

let harness: WorkflowHarness | undefined;

test.afterEach(async () => {
  await harness?.server.stop();
  await harness?.pool.end();
  await dropIsolatedDatabase(harness?.database);
  if (harness?.objectRoot) await rm(harness.objectRoot, { recursive: true, force: true });
  harness = undefined;
});

test("first-run setup can import synthetic and AWS CSV, forecast, optimize, and render a recommendation report", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(45_000);
  harness = await createWorkflowHarness();
  const traffic = captureTraffic(page);

  await login(context, page, harness);
  await expect(
    page.getByRole("heading", { level: 1, name: "Current commitment posture" }),
  ).toBeVisible();

  const api = await workflowApi(context, harness.server.url);
  const account = await postJson(api, `${harness.server.url}/api/cloud-accounts`, {
    provider: "aws",
    external_ref: "111122223333",
    display_name: "E2E AWS payer",
    currency: "USD",
    tags: { environment: "e2e" },
  });
  const accountId = account.id as string;

  const objectStore = createLocalObjectStore(harness.objectRoot);
  await objectStore.put("imports/e2e/synthetic.csv", Buffer.from(syntheticCsv(), "utf8"));
  await objectStore.put("imports/e2e/aws-cur.csv", Buffer.from(awsCurCsv(), "utf8"));
  await objectStore.close();

  const synthetic = await postJson(api, `${harness.server.url}/api/imports`, {
    source: "synthetic",
    format: "csv",
    object_uri: "imports/e2e/synthetic.csv",
    cloud_account_id: accountId,
    control_totals: [controlTotal("2026-01", "10000"), controlTotal("2026-02", "12000")],
  });
  expect(synthetic).toMatchObject({ source: "synthetic", status: "completed", line_count: "2" });

  const awsCur = await postJson(api, `${harness.server.url}/api/imports`, {
    source: "aws_cur",
    format: "csv",
    object_uri: "imports/e2e/aws-cur.csv",
    cloud_account_id: accountId,
    control_totals: [controlTotal("2026-03", "8000")],
  });
  expect(awsCur).toMatchObject({ source: "aws_cur", status: "completed", line_count: "1" });

  const priceTable = await postJson(
    api,
    `${harness.server.url}/api/price-tables`,
    priceTableBody(),
  );
  const activatedPrice = await postJson(
    api,
    `${harness.server.url}/api/price-tables/${priceTable.id}/activate`,
    {},
  );
  expect(activatedPrice).toMatchObject({ id: priceTable.id, status: "active" });

  const model = await postJson(api, `${harness.server.url}/api/forecast-models`, {
    name: "E2E seasonal naive",
    provider_scope: ["aws"],
    service_scope: ["AmazonEC2"],
    horizon_months: 3,
    method: "seasonal_naive",
    config: { seasonality: "monthly" },
  });
  const forecastRun = await postJson(api, `${harness.server.url}/api/forecast-runs`, {
    forecast_model_id: model.id,
    input_window_start: "2026-01-01",
    input_window_end: "2026-03-31",
    horizon_months: 3,
    random_seed: "20260826",
  });

  const forecastWorker = createForecastWorker(
    createForecastRepository(harness.pool),
    createLocalObjectStore(harness.objectRoot),
    { minHistoryDays: 90 },
  );
  await expect(forecastWorker.processNextForecastRun()).resolves.toMatchObject({
    processed: true,
    status: "completed",
    runId: forecastRun.id,
  });

  const policy = await postJson(api, `${harness.server.url}/api/optimizer-policies`, {
    name: "E2E risk policy",
    objective: "maximize_expected_savings",
    max_downside_loss_cents: "2000",
    min_expected_savings_cents: "1000",
    max_utilization_gap_pct: "25.00",
    approval_threshold_cents: "50000",
    allowed_instruments: ["aws_compute_savings_plan"],
    config: { liquidity_penalty_bps: 0 },
  });
  const activatedPolicy = await patchJson(
    api,
    `${harness.server.url}/api/optimizer-policies/${policy.id}`,
    { status: "active" },
  );
  expect(activatedPolicy).toMatchObject({ id: policy.id, status: "active" });

  const optimizerRun = await postJson(api, `${harness.server.url}/api/optimizer-runs`, {
    forecast_run_id: forecastRun.id,
    optimizer_policy_id: policy.id,
    price_table_version_ids: [priceTable.id],
  });
  await expect(
    createOptimizerWorker(
      createOptimizerRunsRepository(harness.pool),
      createLocalObjectStore(harness.objectRoot),
    ).processNextOptimizerRun(),
  ).resolves.toMatchObject({ processed: true, status: "completed", runId: optimizerRun.id });

  const recommendations = (await getJson(
    api,
    `${harness.server.url}/api/recommendations?limit=1`,
  )) as RecommendationListBody;
  expect(recommendations.recommendations).toHaveLength(1);
  const recommendationId = recommendations.recommendations[0]!.id;
  const report = (await getJson(
    api,
    `${harness.server.url}/api/reports/recommendation/${recommendationId}`,
  )) as ReportBody;
  expect(report.report_snapshot).toMatchObject({
    source_type: "recommendation",
    status: "rendered",
  });

  const response = await page.goto(`${harness.server.url}/recommendations/${recommendationId}`, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Recommendation report" }),
  ).toBeVisible();
  await expect(page.getByText("Expected net saving")).toBeVisible();
  await expect(page.getByText("Immutable report state")).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);
  expect(traffic.requests.filter(({ url }) => !sameOrigin(url, harness!.server.url))).toEqual([]);
  expect(traffic.console.filter(({ type }) => type === "error")).toEqual([]);

  const evidenceRoot = resolve(
    process.env.APP_E2E_EVIDENCE_DIR ?? ".tmp/playwright-evidence/first-run-workflow",
  );
  const screenshot = resolve(evidenceRoot, "recommendation-report.png");
  const summary = resolve(evidenceRoot, "workflow-summary.json");
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  await writeFile(
    summary,
    `${JSON.stringify(
      {
        syntheticImportId: synthetic.id,
        awsCurImportId: awsCur.id,
        forecastRunId: forecastRun.id,
        optimizerRunId: optimizerRun.id,
        recommendationId,
        reportSnapshotId: report.report_snapshot.id,
        requestCount: traffic.requests.length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await testInfo.attach("first-run-recommendation-report", {
    path: screenshot,
    contentType: "image/png",
  });
});

async function createWorkflowHarness(): Promise<WorkflowHarness> {
  const database = await createIsolatedDatabase("ccpo_e2e_first_run_workflow");
  const root = await mkdtemp(join(tmpdir(), "ccpo-e2e-first-run-"));
  const objectRoot = resolve(root, "objects");
  const passwordPath = resolve(root, "admin-password.txt");
  const privateKeyPath = resolve(root, "jwt-private.pem");
  const publicKeyPath = resolve(root, "jwt-public.pem");
  const port = await allocatePort();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await mkdir(objectRoot, { recursive: true });
  await writeFile(passwordPath, "Correct Horse Battery Staple 2026!", "utf8");
  await writeFile(
    privateKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    "utf8",
  );
  await writeFile(
    publicKeyPath,
    publicKey.export({ type: "spki", format: "pem" }).toString(),
    "utf8",
  );
  const environment = {
    DATABASE_URL: database.url,
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    OBJECT_STORAGE_PATH: objectRoot,
    JWT_PRIVATE_KEY_PATH: privateKeyPath,
    JWT_PUBLIC_KEY_PATH: publicKeyPath,
    DEFAULT_TENANT_NAME: "E2E Portfolio Tenant",
    DEFAULT_ADMIN_EMAIL: "admin@e2e.example.invalid",
    DEFAULT_ADMIN_NAME: "E2E Administrator",
    DEFAULT_ADMIN_PASSWORD_FILE: passwordPath,
    API_KEY_PREFIX: "ccpo",
    AUTH_LIMITER_MODE: "local",
    USERS_LIMITER_MODE: "local",
    DB_POOL_CONNECTION_TIMEOUT_MS: "2000",
  };
  const setup = await runSetup(environment);
  const server = await startE2eServer({
    target: "application",
    port,
    startupTimeoutMs: 15_000,
    environment,
  });
  const pool = new Pool({ connectionString: database.url, max: 6 });
  return {
    database,
    objectRoot,
    passwordPath,
    privateKeyPath,
    publicKeyPath,
    pool,
    server,
    tenantId: setup.tenantId,
  };
}

async function runSetup(
  environment: Readonly<Record<string, string>>,
): Promise<{ tenantId: string }> {
  const output = await spawnOutput(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/setup.ts"],
    environment,
  );
  const lines = output.stdout
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const initialized = lines.find((line) => line.event === "first_run_initialized");
  if (!initialized || typeof initialized.tenantId !== "string") {
    throw new Error("First-run setup did not emit initialized tenant metadata.");
  }
  return { tenantId: initialized.tenantId };
}

async function spawnOutput(
  command: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: resolve("."),
      env: { ...process.env, ...environment, NODE_ENV: "test" },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`Command failed with code ${code}: ${stderr}`));
    });
  });
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate a TCP port.")));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function login(context: BrowserContext, page: Page, state: WorkflowHarness): Promise<void> {
  await page.goto(`${state.server.url}/login`, { waitUntil: "networkidle" });
  const response = await context.request.post(`${state.server.url}/api/auth/login`, {
    headers: { origin: state.server.url },
    data: {
      tenant_id: state.tenantId,
      email: "admin@e2e.example.invalid",
      password: "Correct Horse Battery Staple 2026!",
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto(`${state.server.url}/dashboard`, { waitUntil: "networkidle" });
}

async function postJson(
  api: WorkflowApi,
  url: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await api.request.post(url, { data, headers: unsafeHeaders(api) });
  expect(response.status(), `${url}: ${await response.text()}`).toBeLessThan(300);
  return (await response.json()) as Record<string, unknown>;
}

async function patchJson(
  api: WorkflowApi,
  url: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await api.request.patch(url, { data, headers: unsafeHeaders(api) });
  expect(response.status(), `${url}: ${await response.text()}`).toBeLessThan(300);
  return (await response.json()) as Record<string, unknown>;
}

async function getJson(api: WorkflowApi, url: string): Promise<Record<string, unknown>> {
  const response = await api.request.get(url);
  expect(response.status(), `${url}: ${await response.text()}`).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function workflowApi(context: BrowserContext, origin: string): Promise<WorkflowApi> {
  const csrf = (await context.cookies(origin)).find((cookie) => cookie.name === "ccpo_csrf");
  if (!csrf?.value) throw new Error("Browser session did not receive the CSRF cookie.");
  return { origin, request: context.request, csrfToken: csrf.value };
}

function unsafeHeaders(api: WorkflowApi): Record<string, string> {
  return { origin: api.origin, "x-csrf-token": api.csrfToken };
}

function controlTotal(month: string, onDemandCostCents: string): Record<string, string> {
  return {
    provider: "aws",
    service_code: "AmazonEC2",
    region: "us-east-1",
    month,
    line_count: "1",
    usage_quantity: "1.00000000",
    on_demand_cost_cents: onDemandCostCents,
    realized_cost_cents: onDemandCostCents,
    commitment_applied_cents: "0",
  };
}

function syntheticCsv(): string {
  return [
    "provider,service_code,sku,region,usage_start,usage_end,usage_quantity,usage_unit,on_demand_cost_cents,realized_cost_cents,commitment_applied_cents,tags",
    'aws,AmazonEC2,BoxUsage:m7g.large,us-east-1,2026-01-01,2026-01-31,1.00000000,Hrs,10000,10000,0,"{""env"":""e2e""}"',
    'aws,AmazonEC2,BoxUsage:m7g.large,us-east-1,2026-02-01,2026-02-28,1.00000000,Hrs,12000,12000,0,"{""env"":""e2e""}"',
    "",
  ].join("\n");
}

function awsCurCsv(): string {
  return [
    "lineItem/UsageAccountId,lineItem/ProductCode,lineItem/UsageType,product/region,lineItem/UsageStartDate,lineItem/UsageEndDate,lineItem/UsageAmount,lineItem/UsageUnit,pricing/publicOnDemandCost,lineItem/UnblendedCost,resourceTags/user:Environment",
    "111122223333,AmazonEC2,BoxUsage:m7g.large,us-east-1,2026-03-01,2026-03-31,1.00000000,Hrs,80.00,80.00,e2e",
    "",
  ].join("\n");
}

function priceTableBody(): Record<string, unknown> {
  return {
    provider: "aws",
    instrument: "aws_compute_savings_plan",
    version_label: "e2e-csp-2026-08",
    effective_from: "2026-08-01",
    effective_to: null,
    source_uri: "prices/e2e/csp-2026-08.json",
    items: [
      {
        sku: "ComputeSP:m7g.large",
        region: "us-east-1",
        term_months: 12,
        payment_option: "no_upfront",
        hourly_rate_cents: "10",
        upfront_cents: "0",
        coverage_rules: { service_code: "AmazonEC2", usage_family: "compute" },
      },
    ],
  };
}

function captureTraffic(page: Page): Traffic {
  const traffic: Traffic = { console: [], requests: [] };
  page.on("console", (message) =>
    traffic.console.push({ type: message.type(), text: message.text() }),
  );
  page.on("request", (request) =>
    traffic.requests.push({ method: request.method(), url: request.url() }),
  );
  return traffic;
}

function sameOrigin(left: string, right: string): boolean {
  return new URL(left).origin === new URL(right).origin;
}
