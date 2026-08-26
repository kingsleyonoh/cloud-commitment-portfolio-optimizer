import type { BacktestDetail, BacktestRun } from "../../core/backtests/backtests-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--teal:#3d9b83;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}
body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}
.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}
main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}
h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.flow{display:grid;gap:1rem}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.35rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.num,.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.completed{color:#bde8dc}.queued,.running{color:#f3d39b}.failed{color:#f0c7c2}.cancelled{color:var(--muted)}.pass{color:#bde8dc}.warn{color:#f3d39b}.notice,.empty{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.danger{border-left-color:var(--danger);color:#f0c7c2}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}.back{display:inline-block;margin-bottom:1rem}.selected{color:var(--cyan);font-weight:700}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export interface BacktestsPageOptions {
  backtests: readonly BacktestRun[];
  role: UserRole;
}

export interface BacktestDetailPageOptions {
  detail: BacktestDetail;
  role: UserRole;
}

export function renderBacktestsPage(options: BacktestsPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Backtests | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#backtests">Skip to backtests</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)} · replay lab</div>
</header>
<main id="backtests">
<p class="eyebrow">Replay credibility</p>
<h1>Backtest replay lab</h1>
<p class="lede">Compare commitment heuristics against the same historical usage window, inspect savings and regret together, and verify that every decision saw prior months only.</p>
<div class="grid">
<section class="panel" aria-labelledby="backtest-list">
<h2 id="backtest-list">Replay inventory · Compare baselines</h2>
${renderQueueMetrics(options.backtests)}
${renderBacktestTable(options.backtests)}
</section>
<aside class="rail" aria-labelledby="replay-guidance">
<h2 id="replay-guidance">Replay guidance</h2>
<p class="help">Queue a replay through the backtest API after selecting an active policy and a bounded historical window.</p>
<ol>
<li>Compare no commitment, last-month steady state, and 70% utilization.</li>
<li>Read savings beside regret and downside loss.</li>
<li>Confirm the no-future-leakage seal before changing policy.</li>
</ol>
</aside>
</div>
</main>
</body>
</html>`;
}

export function renderBacktestDetailPage(options: BacktestDetailPageOptions): string {
  const run = options.detail.backtest;
  const metrics = run.metrics;
  const selected = stringAt(metrics, "baseline", run.baseline);
  const leakage = booleanAt(metrics, "no_future_leakage");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Backtest replay | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#backtest-detail">Skip to backtest detail</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)} · ${escapeHtml(run.status)}</div>
</header>
<main id="backtest-detail">
<a class="back" href="/backtests">← Back to replay inventory</a>
<p class="eyebrow">Deterministic replay</p>
<h1>Backtest replay detail</h1>
<p class="lede">${escapeHtml(run.name)} · ${escapeHtml(run.window_start)} through ${escapeHtml(run.window_end)}</p>
${renderDetailMetrics(run)}
<div class="grid">
<div class="flow">
<section class="panel" aria-labelledby="baseline-comparison">
<h2 id="baseline-comparison">Baseline comparison</h2>
${renderBaselineComparison(metrics, selected)}
</section>
<section class="panel" aria-labelledby="monthly-evidence">
<h2 id="monthly-evidence">12-month replay evidence</h2>
${renderMonthlyEvidence(metrics, selected)}
</section>
</div>
<aside class="rail" aria-labelledby="replay-seal">
<h2 id="replay-seal">Replay integrity</h2>
<p class="${leakage ? "notice pass" : "notice danger"}">${leakage ? "No future leakage" : "Leakage evidence unavailable"}</p>
<div class="table-wrap"><table><caption>Replay provenance.</caption><tbody>
<tr><th scope="row">Status</th><td><span class="status ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></td></tr>
<tr><th scope="row">Selected baseline</th><td>${escapeHtml(labelBaseline(selected))}</td></tr>
<tr><th scope="row">Replay months</th><td class="num">${escapeHtml(stringAt(metrics, "replay_months", "0"))}</td></tr>
<tr><th scope="row">Source line items</th><td class="num">${escapeHtml(stringAt(metrics, "source_line_items", "0"))}</td></tr>
<tr><th scope="row">Policy</th><td>Frozen policy snapshot</td></tr>
</tbody></table></div>
${renderErrors(run)}
</aside>
</div>
</main>
</body>
</html>`;
}

function renderQueueMetrics(runs: readonly BacktestRun[]): string {
  return `<div class="metrics" aria-label="Backtest status summary">
<div class="metric"><strong>${runs.length}</strong><span>Total replays</span></div>
<div class="metric"><strong>${countStatus(runs, "completed")}</strong><span>Completed</span></div>
<div class="metric"><strong>${countStatus(runs, "queued") + countStatus(runs, "running")}</strong><span>In flight</span></div>
<div class="metric"><strong>${countStatus(runs, "failed") + countStatus(runs, "cancelled")}</strong><span>Needs review</span></div>
</div>`;
}

function renderBacktestTable(runs: readonly BacktestRun[]): string {
  if (runs.length === 0) {
    return '<p class="empty">No replay runs yet. Queue a bounded historical backtest after an active policy is ready.</p>';
  }
  const rows = runs.map((run) => {
    const metrics = run.metrics;
    const leakage = booleanAt(metrics, "no_future_leakage");
    return `<tr>
<td><span class="status ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></td>
<td><a href="/backtests/${escapeHtml(run.id)}">Review replay</a><div>${escapeHtml(run.name)}</div><div class="mono help">${escapeHtml(run.id)}</div></td>
<td>${escapeHtml(labelBaseline(run.baseline))}</td>
<td class="mono">${escapeHtml(run.window_start)}<br>${escapeHtml(run.window_end)}</td>
<td class="num">${formatCents(valueAt(metrics, "selected_simulated_savings_cents"))}<br><span class="help">regret ${formatCents(valueAt(metrics, "selected_regret_cents"))}</span></td>
<td class="num">${formatCents(valueAt(metrics, "selected_downside_loss_cents"))}</td>
<td>${leakage ? '<span class="status pass">No future leakage</span>' : '<span class="status warn">Evidence pending</span>'}</td>
<td>${renderErrors(run)}</td>
</tr>`;
  });
  return `<div class="table-wrap"><table><caption>Tenant-scoped replay runs. Object locations and raw usage rows stay server-side.</caption><thead><tr><th scope="col">Status</th><th scope="col">Replay</th><th scope="col">Selected baseline</th><th scope="col">Window</th><th scope="col">Savings/regret</th><th scope="col">Downside</th><th scope="col">Integrity</th><th scope="col">Error</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function renderDetailMetrics(run: BacktestRun): string {
  const metrics = run.metrics;
  return `<div class="metrics" aria-label="Backtest economics">
<div class="metric"><strong>${formatCents(valueAt(metrics, "selected_simulated_savings_cents"))}</strong><span>Selected baseline savings</span></div>
<div class="metric"><strong>${formatCents(valueAt(metrics, "selected_regret_cents"))}</strong><span>Selected regret</span></div>
<div class="metric"><strong>${formatCents(valueAt(metrics, "selected_downside_loss_cents"))}</strong><span>Downside loss</span></div>
<div class="metric"><strong>${formatCents(valueAt(metrics, "best_simulated_savings_cents"))}</strong><span>Best baseline savings</span></div>
</div>`;
}

function renderBaselineComparison(metrics: Record<string, unknown>, selected: string): string {
  const results = recordsAt(metrics, "baseline_results");
  if (results.length === 0) {
    return '<p class="notice">Baseline comparison metrics are not available until the replay worker completes.</p>';
  }
  const rows = results.map((result) => {
    const baseline = stringAt(result, "baseline", "custom");
    return `<tr>
<th scope="row">${escapeHtml(labelBaseline(baseline))}${baseline === selected ? ' <span class="selected">(selected)</span>' : ""}</th>
<td class="num">${formatCents(valueAt(result, "simulated_savings_cents"))}</td>
<td class="num">${formatCents(valueAt(result, "regret_cents"))}</td>
<td class="num">${formatCents(valueAt(result, "downside_loss_cents"))}</td>
</tr>`;
  });
  return `<div class="table-wrap"><table><caption>All baselines use the same frozen replay window.</caption><thead><tr><th scope="col">Baseline</th><th scope="col">Savings</th><th scope="col">Regret</th><th scope="col">Downside loss</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function renderMonthlyEvidence(metrics: Record<string, unknown>, selected: string): string {
  const result = recordsAt(metrics, "baseline_results").find(
    (entry) => stringAt(entry, "baseline", "") === selected,
  );
  const months = result ? recordsAt(result, "monthly_results") : [];
  if (months.length === 0) {
    return '<p class="notice">Monthly decision evidence is not available for this replay.</p>';
  }
  const rows = months.map(
    (month) => `<tr>
<th scope="row">${escapeHtml(stringAt(month, "month", "unknown"))}</th>
<td class="num">${formatCents(valueAt(month, "simulated_commitment_cents"))}</td>
<td class="num">${formatCents(valueAt(month, "simulated_savings_cents"))}</td>
<td class="num">${formatCents(valueAt(month, "regret_cents"))}</td>
<td>${renderDecisionInputs(month)}</td>
</tr>`,
  );
  return `<div class="table-wrap"><table><caption>Accessible data-table alternative to a savings/regret chart; each decision is based on prior actual months.</caption><thead><tr><th scope="col">Month</th><th scope="col">Commitment</th><th scope="col">Savings</th><th scope="col">Regret</th><th scope="col">Visible history</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function renderDecisionInputs(month: Record<string, unknown>): string {
  const inputs = nestedRecord(month, "decision_inputs");
  return `<span class="help">${escapeHtml(stringAt(inputs, "prior_months_seen", "0"))} prior month(s); latest ${escapeHtml(stringAt(inputs, "latest_visible_month", "none"))}</span>`;
}

function renderErrors(run: BacktestRun): string {
  if (Object.keys(run.error_details).length === 0) return "";
  return `<div class="notice danger"><strong>Replay failed</strong><br>${Object.entries(
    run.error_details,
  )
    .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(String(value))}`)
    .join("<br>")}</div>`;
}

function recordsAt(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function nestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function valueAt(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return value === undefined || value === null ? "" : String(value);
}

function stringAt(source: Record<string, unknown>, key: string, fallback: string): string {
  return valueAt(source, key) || fallback;
}

function booleanAt(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

function formatCents(value: string): string {
  const cents = Number.parseInt(value, 10);
  if (!Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function countStatus(runs: readonly BacktestRun[], status: BacktestRun["status"]): number {
  return runs.filter((run) => run.status === status).length;
}

function labelBaseline(baseline: string): string {
  if (baseline === "no_commitment") return "No commitment";
  if (baseline === "last_month_steady_state") return "Last-month steady state";
  if (baseline === "seventy_percent_utilization") return "70% utilization";
  return baseline;
}
