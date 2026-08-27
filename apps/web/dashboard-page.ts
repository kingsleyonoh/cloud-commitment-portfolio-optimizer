import type { DashboardSummary } from "../../core/dashboard/dashboard-types.js";
import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--teal:#3d9b83;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}
body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,button:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}
.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}
main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}
h1{margin:.5rem 0 0;font:600 clamp(2.4rem,6vw,5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:56rem;color:var(--muted);font-size:1.1rem}
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(18rem,3fr) minmax(14rem,2fr);gap:1rem;align-items:start}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}
.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.6rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.65rem;border-top:1px solid var(--rule);text-align:left}td:last-child,th:last-child{text-align:right}.num{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.empty{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}.seal{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}
@media (max-width:980px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderDashboardPage(summary: DashboardSummary): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Dashboard | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#dashboard">Skip to dashboard</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(summary.tenant.displayName)} · ${escapeHtml(summary.role)}</div>
</header>
<main id="dashboard">
<p class="eyebrow">Portfolio command center</p>
<h1>Current commitment posture</h1>
<p class="lede">Triage import health and recommendation status before changing forecasts, policies, or cloud commitment decisions.</p>
<div class="grid">
<section class="panel" aria-labelledby="portfolio-summary">
<h2 id="portfolio-summary">Portfolio summary</h2>
<div class="metrics">
<div class="metric"><strong>${total(summary.importStatuses)}</strong><span>Imports tracked</span></div>
<div class="metric"><strong>${total(summary.recommendationStatuses)}</strong><span>Recommendations tracked</span></div>
</div>
${renderImportTable(summary)}
${renderRecommendationTable(summary)}
</section>
<aside class="rail" aria-labelledby="risk-rail">
<h2 id="risk-rail">Risk rail</h2>
<ol>
<li>No-action baseline stays visible until optimizer output exists.</li>
<li>Expected net saving must travel with p95 downside.</li>
<li>Confidence and risk band are not color-only states.</li>
<li>Frozen inputs and reports remain replayable.</li>
</ol>
</aside>
<aside class="panel" aria-labelledby="provenance">
<h2 id="provenance">Provenance</h2>
<p class="seal">Currency ${escapeHtml(summary.tenant.defaultCurrency)}</p>
<p class="seal">Risk budget ${escapeHtml(summary.tenant.riskBudgetCents)} cents</p>
<p class="seal">Timezone ${escapeHtml(summary.tenant.timezone)}</p>
</aside>
</div>
</main>
</body>
</html>`;
}

function renderImportTable(summary: DashboardSummary): string {
  if (summary.importStatuses.length === 0) {
    return '<h3>Import health</h3><p class="empty">No imports yet. Upload billing evidence before running forecasts.</p>';
  }
  const rows = summary.importStatuses
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.status)}</td><td class="num">${row.count}</td><td>${escapeHtml(
          row.latestAt ?? "none",
        )}</td></tr>`,
    )
    .join("");
  return `<h3>Import health</h3><table><caption>Tenant import batches grouped by status.</caption><thead><tr><th scope="col">Status</th><th scope="col">Count</th><th scope="col">Latest</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRecommendationTable(summary: DashboardSummary): string {
  if (summary.recommendationStatuses.length === 0) {
    return '<h3>Recommendation status</h3><p class="empty">No recommendations yet. Run the optimizer after imports, prices, forecasts, and policy are ready.</p>';
  }
  const rows = summary.recommendationStatuses
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.riskBand)}</td><td class="num">${
          row.count
        }</td><td class="num">${escapeHtml(row.expectedSavingsCents)}</td><td class="num">${escapeHtml(
          row.p95DownsideLossCents,
        )}</td></tr>`,
    )
    .join("");
  return `<h3>Recommendation status</h3><table><caption>Expected saving is paired with downside exposure.</caption><thead><tr><th scope="col">Status</th><th scope="col">Risk</th><th scope="col">Count</th><th scope="col">Expected saving cents</th><th scope="col">p95 downside cents</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function total(rows: readonly { count: number }[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}
