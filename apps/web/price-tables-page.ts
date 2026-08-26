import type {
  PriceTableStatus,
  PriceTableVersion,
} from "../../core/price-tables/price-tables-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

export interface PriceTablesPageOptions {
  priceTables: readonly PriceTableVersion[];
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
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.active{color:#bde8dc}.draft{color:#f3d39b}.blocked{color:#f0c7c2}.superseded{color:var(--muted)}
.empty,.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderPriceTablesPage(options: PriceTablesPageOptions): string {
  const admin = options.role === "tenant_admin";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Price tables | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#price-tables">Skip to price tables</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)}</div>
</header>
<main id="price-tables">
<p class="eyebrow">Economic inputs</p>
<h1>Price table control</h1>
<p class="lede">Review AWS Compute Savings Plan price snapshots before forecasts and optimizer runs consume active economics.</p>
<div class="grid">
<section class="panel" aria-labelledby="price-table-versions">
<h2 id="price-table-versions">Version inventory</h2>
${renderMetrics(options.priceTables)}
${renderVersionTable(options.priceTables)}
</section>
<aside class="rail" aria-labelledby="price-controls">
<h2 id="price-controls">${admin ? "Tenant Admin price controls" : "Read-only price access"}</h2>
${admin ? renderAdminGuidance() : renderReadOnlyGuidance()}
</aside>
</div>
</main>
</body>
</html>`;
}

function renderMetrics(priceTables: readonly PriceTableVersion[]): string {
  return `<div class="metrics" aria-label="Price table status summary">
<div class="metric"><strong>${priceTables.length}</strong><span>Total versions</span></div>
<div class="metric"><strong>${countStatus(priceTables, "active")}</strong><span>Active</span></div>
<div class="metric"><strong>${countStatus(priceTables, "draft")}</strong><span>Draft</span></div>
<div class="metric"><strong>${countStatus(priceTables, "blocked")}</strong><span>Blocked</span></div>
</div>`;
}

function renderVersionTable(priceTables: readonly PriceTableVersion[]): string {
  if (priceTables.length === 0) {
    return '<p class="empty">No price tables yet. Stage an AWS Compute Savings Plan table before optimizer runs.</p>';
  }
  const rows = priceTables.map(renderVersionRow).join("");
  return `<div class="table-wrap"><table><caption>Tenant-scoped price versions. Source URIs are intentionally hidden from the browser.</caption><thead><tr><th scope="col">Version</th><th scope="col">Instrument</th><th scope="col">Status</th><th scope="col">Effective</th><th scope="col">Items</th><th scope="col">Checksum</th><th scope="col">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderVersionRow(version: PriceTableVersion): string {
  return `<tr>
<td>${escapeHtml(version.version_label)}</td>
<td>${escapeHtml(labelInstrument(version.instrument))}</td>
<td><span class="status ${escapeHtml(version.status)}">${escapeHtml(version.status)}</span></td>
<td class="mono">${escapeHtml(version.effective_from)}${version.effective_to ? ` → ${escapeHtml(version.effective_to)}` : ""}</td>
<td class="num">${escapeHtml(version.item_count)}</td>
<td class="mono">${escapeHtml(shortChecksum(version.checksum))}</td>
<td class="mono">${escapeHtml(version.updated_at)}</td>
</tr>`;
}

function renderAdminGuidance(): string {
  return `<p class="help">Upload staging is handled by the JSON API so checksums, immutable items, and source provenance stay explicit.</p>
<ol>
<li>Upload staging: create a draft through <span class="mono">POST /api/price-tables</span> with every priced SKU and coverage rule.</li>
<li>Activation gate: activate fresh drafts through <span class="mono">POST /api/price-tables/{id}/activate</span>.</li>
<li>Blocked versions indicate stale or invalid economics that must not feed optimizer runs.</li>
</ol>`;
}

function renderReadOnlyGuidance(): string {
  return '<p class="notice">Read-only price access. Tenant Admin authority is required to create or activate price tables.</p>';
}

function countStatus(priceTables: readonly PriceTableVersion[], status: PriceTableStatus): number {
  return priceTables.filter((version) => version.status === status).length;
}

function labelInstrument(instrument: PriceTableVersion["instrument"]): string {
  if (instrument === "aws_compute_savings_plan") return "AWS Compute Savings Plan";
  return instrument;
}

function shortChecksum(checksum: string): string {
  return `${checksum.slice(0, 8)}…${checksum.slice(-8)}`;
}
