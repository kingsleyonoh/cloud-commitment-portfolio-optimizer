import type {
  ForecastModel,
  ForecastModelStatus,
  ForecastRun,
  ForecastRunStatus,
} from "../../core/forecasting/forecast-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

export interface ForecastsPageOptions {
  models: readonly ForecastModel[];
  runs: readonly ForecastRun[];
  role: UserRole;
}

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--teal:#3d9b83;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}
body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,button:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}
.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}
main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}
h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.flow{display:grid;gap:1rem}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-bottom:1rem}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.55rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.num,.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.active,.completed{color:#bde8dc}.draft,.queued,.running{color:#f3d39b}.failed{color:#f0c7c2}.archived,.cancelled{color:var(--muted)}
.empty,.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.danger{border-left-color:var(--danger);color:#f0c7c2}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:900px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderForecastsPage(options: ForecastsPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Forecasts | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#forecasts">Skip to forecasts</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)}</div>
</header>
<main id="forecasts">
<p class="eyebrow">Demand planning</p>
<h1>Forecast control</h1>
<p class="lede">Create deterministic seasonal-naive demand forecasts, review worker outcomes, and keep low-history warnings visible before optimizer runs.</p>
<div class="grid">
<div class="flow">
<section class="panel" aria-labelledby="forecast-models">
<h2 id="forecast-models">Forecast models</h2>
${renderModelMetrics(options.models)}
${renderModelsTable(options.models)}
</section>
<section class="panel" aria-labelledby="forecast-runs">
<h2 id="forecast-runs">Forecast runs</h2>
${renderRunMetrics(options.runs)}
${renderRunsTable(options.runs)}
</section>
</div>
<aside class="rail" aria-labelledby="forecast-controls">
<h2 id="forecast-controls">${options.role === "tenant_admin" ? "Tenant Admin settings" : "Forecast operator controls"}</h2>
<p class="help">Run gate: active model, tenant-scoped imported usage, explicit input window, horizon, and deterministic random seed.</p>
<ol>
<li>Seasonal-naive is the P1 model path.</li>
<li>Quality warnings stay attached to completed runs.</li>
<li>Failed runs show sanitized error codes and never raw worker traces.</li>
</ol>
</aside>
</div>
</main>
</body>
</html>`;
}

function renderModelMetrics(models: readonly ForecastModel[]): string {
  return `<div class="metrics" aria-label="Forecast model status summary">
<div class="metric"><strong>${models.length}</strong><span>Total models</span></div>
<div class="metric"><strong>${countModelStatus(models, "active")}</strong><span>Active</span></div>
<div class="metric"><strong>${countModelStatus(models, "draft")}</strong><span>Draft</span></div>
<div class="metric"><strong>${countModelStatus(models, "archived")}</strong><span>Archived</span></div>
</div>`;
}

function renderRunMetrics(runs: readonly ForecastRun[]): string {
  return `<div class="metrics" aria-label="Forecast run status summary">
<div class="metric"><strong>${runs.length}</strong><span>Total runs</span></div>
<div class="metric"><strong>${countRunStatus(runs, "completed")}</strong><span>Completed</span></div>
<div class="metric"><strong>${countRunStatus(runs, "queued") + countRunStatus(runs, "running")}</strong><span>In flight</span></div>
<div class="metric"><strong>${countRunStatus(runs, "failed")}</strong><span>Failed</span></div>
</div>`;
}

function renderModelsTable(models: readonly ForecastModel[]): string {
  if (models.length === 0) {
    return '<p class="empty">No forecast models yet. Create an active seasonal-naive model before scheduling runs.</p>';
  }
  const rows = models.map(renderModelRow).join("");
  return `<div class="table-wrap"><table><caption>Tenant-scoped forecast model inventory.</caption><thead><tr><th scope="col">Name</th><th scope="col">Method</th><th scope="col">Scope</th><th scope="col">Horizon</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderModelRow(model: ForecastModel): string {
  return `<tr>
<td>${escapeHtml(model.name)}</td>
<td>${escapeHtml(model.method)}</td>
<td>${escapeHtml([...model.provider_scope, ...model.service_scope].join(" · "))}</td>
<td class="num">${model.horizon_months} months</td>
<td><span class="status ${escapeHtml(model.status)}">${escapeHtml(model.status)}</span></td>
<td class="mono">${escapeHtml(model.updated_at)}</td>
</tr>`;
}

function renderRunsTable(runs: readonly ForecastRun[]): string {
  if (runs.length === 0) {
    return '<p class="empty">No forecast runs yet. Run a forecast after imports have enough history.</p>';
  }
  const rows = runs.map(renderRunRow).join("");
  return `<div class="table-wrap"><table><caption>Forecast run outcomes. Output artifact URIs are intentionally hidden.</caption><thead><tr><th scope="col">Status</th><th scope="col">Input window</th><th scope="col">Horizon</th><th scope="col">Seed</th><th scope="col">Quality warning</th><th scope="col">Error detail</th><th scope="col">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRunRow(run: ForecastRun): string {
  return `<tr>
<td><span class="status ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></td>
<td class="mono">${escapeHtml(run.input_window_start)} → ${escapeHtml(run.input_window_end)}</td>
<td class="num">${run.horizon_months} months</td>
<td class="mono">${escapeHtml(run.random_seed)}</td>
<td>${renderDiagnostic(run.quality_metrics, "No quality warning.")}</td>
<td>${renderDiagnostic(run.error_details, "No error detail.", true)}</td>
<td class="mono">${escapeHtml(run.updated_at)}</td>
</tr>`;
}

function renderDiagnostic(record: Record<string, unknown>, empty: string, danger = false): string {
  if (Object.keys(record).length === 0) return `<span class="help">${empty}</span>`;
  const className = danger ? "notice danger" : "notice";
  return `<div class="${className}">${Object.entries(record)
    .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(String(value))}`)
    .join("<br>")}</div>`;
}

function countModelStatus(models: readonly ForecastModel[], status: ForecastModelStatus): number {
  return models.filter((model) => model.status === status).length;
}

function countRunStatus(runs: readonly ForecastRun[], status: ForecastRunStatus): number {
  return runs.filter((run) => run.status === status).length;
}
