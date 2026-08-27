import type { ImportBatch, ImportStatus } from "../../core/imports/imports-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

export interface ImportsPageOptions {
  imports: readonly ImportBatch[];
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
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin-bottom:1rem}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.55rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.num,.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.completed{color:#bde8dc}.quarantined,.failed{color:#f0c7c2}.processing,.queued{color:#f3d39b}.cancelled{color:var(--muted)}
.empty,.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.danger{border-left-color:var(--danger);color:#f0c7c2}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderImportsPage(options: ImportsPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Imports | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#imports">Skip to imports</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)}</div>
</header>
<main id="imports">
<p class="eyebrow">Evidence intake</p>
<h1>Import health</h1>
<p class="lede">Track billing evidence after upload, isolate quarantined files, and confirm parser drift before forecasts consume canonical usage rows.</p>
<div class="grid">
<section class="panel" aria-labelledby="import-batches">
<h2 id="import-batches">Import batches</h2>
${renderMetrics(options.imports)}
${renderImportsTable(options.imports)}
</section>
<aside class="rail" aria-labelledby="upload-guidance">
<h2 id="upload-guidance">Import writer controls</h2>
<p class="help">Desktop upload path: place source files into object storage, then create a JSON import request with the object key and control totals.</p>
<ol>
<li>Synthetic CSV validates local fixtures and demos.</li>
<li>AWS CUR CSV maps provider billing columns into canonical usage rows.</li>
<li>Quarantined imports keep diagnostics without exposing raw billing rows in the browser.</li>
</ol>
<section class="notice" aria-labelledby="privacy-guidance" data-privacy-consent="billing-export">
<h3 id="privacy-guidance">Before you upload or share</h3>
<ul>
<li>Upload billing exports only for this tenant and purpose.</li>
<li>Do not upload access keys, passwords, tokens, or other credentials.</li>
<li>Provider exports can contain account IDs and resource tags; redact them before sharing with support.</li>
<li>Optional ecosystem adapters require explicit enablement in Integrations.</li>
</ul>
</section>
</aside>
</div>
</main>
</body>
</html>`;
}

function renderMetrics(imports: readonly ImportBatch[]): string {
  const total = imports.length;
  const completed = countStatus(imports, "completed");
  const quarantined = countStatus(imports, "quarantined") + countStatus(imports, "failed");
  return `<div class="metrics" aria-label="Import status summary">
<div class="metric"><strong>${total}</strong><span>Total batches</span></div>
<div class="metric"><strong>${completed}</strong><span>Completed</span></div>
<div class="metric"><strong>${quarantined}</strong><span>Needs review</span></div>
</div>`;
}

function renderImportsTable(imports: readonly ImportBatch[]): string {
  if (imports.length === 0) {
    return '<p class="empty">No imports yet. Upload billing evidence before running forecasts or optimizer scenarios.</p>';
  }
  const rows = imports.map(renderImportRow).join("");
  return `<div class="table-wrap"><table><caption>Most recent tenant-scoped import batches. Object keys and raw billing rows are intentionally hidden.</caption><thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Schema</th><th scope="col">Rows</th><th scope="col">Warnings</th><th scope="col">Quarantine/error</th><th scope="col">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderImportRow(batch: ImportBatch): string {
  return `<tr>
<td>${escapeHtml(labelSource(batch.source))}</td>
<td><span class="status ${escapeHtml(batch.status)}">${escapeHtml(batch.status)}</span></td>
<td class="mono">${escapeHtml(batch.schema_version)}</td>
<td class="num">${escapeHtml(batch.line_count)}</td>
<td>${renderDiagnostics(batch.parser_warnings, "No parser warnings.")}</td>
<td>${renderError(batch)}</td>
<td class="mono">${escapeHtml(batch.updated_at)}</td>
</tr>`;
}

function renderError(batch: ImportBatch): string {
  if (Object.keys(batch.error_details).length === 0) {
    return '<span class="help">No quarantine detail.</span>';
  }
  return `<div class="notice danger">${renderKeyValueSummary(batch.error_details)}</div>`;
}

function renderDiagnostics(records: readonly Record<string, unknown>[], empty: string): string {
  if (records.length === 0) return `<span class="help">${empty}</span>`;
  return records
    .map((record) => `<div class="notice">${renderKeyValueSummary(record)}</div>`)
    .join("");
}

function renderKeyValueSummary(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(String(value))}`)
    .join("<br>");
}

function countStatus(imports: readonly ImportBatch[], status: ImportStatus): number {
  return imports.filter((batch) => batch.status === status).length;
}

function labelSource(source: ImportBatch["source"]): string {
  if (source === "aws_cur") return "AWS CUR CSV";
  if (source === "synthetic") return "Synthetic CSV";
  if (source === "azure_export") return "Azure export";
  return "GCP export";
}
