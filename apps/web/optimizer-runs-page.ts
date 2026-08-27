import type {
  OptimizerRun,
  OptimizerRunStatus,
} from "../../core/optimizer-runs/optimizer-runs-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

export interface OptimizerRunsPageOptions {
  runs: readonly OptimizerRun[];
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
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-bottom:1rem}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.55rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.num,.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.completed{color:#bde8dc}.queued,.running{color:#f3d39b}.failed,.infeasible{color:#f0c7c2}.cancelled{color:var(--muted)}
.empty,.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.danger{border-left-color:var(--danger);color:#f0c7c2}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderOptimizerRunsPage(options: OptimizerRunsPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Optimizer runs | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#optimizer-runs">Skip to optimizer runs</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)}</div>
</header>
<main id="optimizer-runs">
<p class="eyebrow">Portfolio optimizer</p>
<h1>Optimizer run control</h1>
<p class="lede">Track queued optimizer jobs, completed frontiers, and infeasible scenarios before promoting recommendations to finance review.</p>
<div class="grid">
<section class="panel" aria-labelledby="optimizer-run-list">
<h2 id="optimizer-run-list">Run inventory</h2>
${renderMetrics(options.runs)}
${renderRunsTable(options.runs)}
</section>
<aside class="rail" aria-labelledby="optimizer-guidance">
<h2 id="optimizer-guidance">Run gate</h2>
<p class="help">Runs require a completed forecast, active optimizer policy, active AWS Compute Savings Plan prices, and frozen input snapshot.</p>
<ol>
<li>Completed runs expose a frontier-ready state without browser object keys.</li>
<li>Infeasible runs show ranked relaxation details when available.</li>
<li>Failed runs show sanitized error codes only.</li>
</ol>
</aside>
</div>
</main>
</body>
</html>`;
}

function renderMetrics(runs: readonly OptimizerRun[]): string {
  return `<div class="metrics" aria-label="Optimizer run status summary">
<div class="metric"><strong>${runs.length}</strong><span>Total runs</span></div>
<div class="metric"><strong>${countStatus(runs, "completed")}</strong><span>Completed</span></div>
<div class="metric"><strong>${countStatus(runs, "queued") + countStatus(runs, "running")}</strong><span>In flight</span></div>
<div class="metric"><strong>${countStatus(runs, "infeasible")}</strong><span>Infeasible</span></div>
</div>`;
}

function renderRunsTable(runs: readonly OptimizerRun[]): string {
  if (runs.length === 0) {
    return '<p class="empty">No optimizer runs yet. Queue a run after forecast, policy, and price tables are ready.</p>';
  }
  const rows = runs.map(renderRunRow).join("");
  return `<div class="table-wrap"><table><caption>Tenant-scoped optimizer runs. Snapshot, output, and frontier object URIs are intentionally hidden.</caption><thead><tr><th scope="col">Status</th><th scope="col">Instrument</th><th scope="col">Prices</th><th scope="col">Seed</th><th scope="col">Frontier</th><th scope="col">Infeasibility</th><th scope="col">Error</th><th scope="col">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRunRow(run: OptimizerRun): string {
  return `<tr>
<td><span class="status ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></td>
<td>${escapeHtml(labelInstrument(run.instrument))}</td>
<td class="num">${run.price_table_version_ids.length}</td>
<td class="mono">${escapeHtml(run.random_seed)}</td>
<td>${run.frontier_uri ? '<span class="status completed">frontier captured</span>' : '<span class="help">No frontier artifact yet.</span>'}</td>
<td>${renderDiagnostic(run.infeasibility_details, "No infeasibility detail.", true)}</td>
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

function countStatus(runs: readonly OptimizerRun[], status: OptimizerRunStatus): number {
  return runs.filter((run) => run.status === status).length;
}

function labelInstrument(instrument: OptimizerRun["instrument"]): string {
  if (instrument === "aws_compute_savings_plan") return "AWS Compute Savings Plan";
  return instrument;
}
