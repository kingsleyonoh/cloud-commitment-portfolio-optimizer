import type { Scenario } from "../../core/scenarios/scenarios-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}
main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.flow{display:grid;gap:1rem}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.35rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.draft{color:#f3d39b}.ready{color:#bde8dc}.archived{color:var(--muted)}.empty,.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}.back{display:inline-block;margin-bottom:1rem}.field{display:grid;gap:.4rem;margin-top:1rem}label{font-weight:700}input,textarea{width:100%;border:1px solid var(--rule);border-radius:.25rem;background:#0d1821;color:var(--ink);padding:.7rem .8rem;font:inherit}textarea{min-height:8rem;resize:vertical}button{min-height:44px;border:0;border-radius:.25rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;font-weight:800;cursor:pointer}.actions{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-top:1rem}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export interface ScenariosPageOptions {
  scenarios: readonly Scenario[];
  role: UserRole;
  csrfToken?: string | undefined;
}

export interface ScenarioDetailPageOptions {
  scenario: Scenario;
  role: UserRole;
}

export function renderScenariosPage(options: ScenariosPageOptions): string {
  const canCreate = options.role === "tenant_admin" || options.role === "finops_analyst";
  return pageShell(
    "Scenarios",
    "scenarios",
    options.role,
    `<p class="eyebrow">Demand and migration shocks</p>
<h1>Scenario workbench</h1>
<p class="lede">Make a named, reviewable shock to a completed forecast before asking the optimizer what the commitment portfolio can absorb.</p>
<div class="grid">
<section class="panel" aria-labelledby="scenario-inventory">
<h2 id="scenario-inventory">Scenario inventory</h2>
${renderMetrics(options.scenarios)}
${renderScenarioTable(options.scenarios)}
</section>
<aside class="rail" aria-labelledby="scenario-guidance">
<h2 id="scenario-guidance">Scenario guardrails</h2>
<ol><li>Use a completed forecast as the base when one is available.</li><li>Keep shock configuration structured and explainable.</li><li>Draft scenarios remain editable inputs for a future optimizer run.</li></ol>
${canCreate ? renderCreateForm(options.csrfToken) : '<p class="notice">Scenario creation is limited to Tenant Admin and FinOps Analyst users.</p>'}
</aside>
</div>`,
  );
}

export function renderScenarioDetailPage(options: ScenarioDetailPageOptions): string {
  const scenario = options.scenario;
  return pageShell(
    "Scenario detail",
    "scenario-detail",
    options.role,
    `<a class="back" href="/scenarios">← Back to scenario workbench</a>
<p class="eyebrow">Scenario packet</p>
<h1>${escapeHtml(scenario.name)}</h1>
<p class="lede">${nullable(scenario.description)}</p>
<div class="grid">
<section class="panel" aria-labelledby="scenario-shock">
<h2 id="scenario-shock">Shock configuration</h2>
${renderShockConfig(scenario.shock_config)}
</section>
<aside class="rail" aria-labelledby="scenario-provenance">
<h2 id="scenario-provenance">Provenance</h2>
<div class="table-wrap"><table><tbody>
<tr><th scope="row">Status</th><td><span class="status ${escapeHtml(scenario.status)}">${escapeHtml(scenario.status)}</span></td></tr>
<tr><th scope="row">Base forecast</th><td class="mono">${scenario.base_forecast_run_id ? escapeHtml(scenario.base_forecast_run_id) : "Not linked"}</td></tr>
<tr><th scope="row">Created</th><td class="mono">${escapeHtml(scenario.created_at)}</td></tr>
<tr><th scope="row">Updated</th><td class="mono">${escapeHtml(scenario.updated_at)}</td></tr>
</tbody></table></div>
<p class="help">Scenario ownership and timestamps are immutable evidence for downstream optimizer runs.</p>
</aside>
</div>`,
  );
}

function pageShell(title: string, id: string, role: UserRole, content: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><title>${title} | ${PRODUCT_NAME}</title><style>${STYLES}</style></head>
<body><a class="skip" href="#${id}">Skip to ${title.toLowerCase()}</a><header class="masthead"><div class="brand">${PRODUCT_NAME}</div><div class="context">${escapeHtml(role)} · scenario workbench</div></header><main id="${id}">${content}</main></body></html>`;
}

function renderMetrics(scenarios: readonly Scenario[]): string {
  return `<div class="metrics" aria-label="Scenario status summary"><div class="metric"><strong>${scenarios.length}</strong><span>Total scenarios</span></div><div class="metric"><strong>${scenarios.filter((scenario) => scenario.status === "draft").length}</strong><span>Draft</span></div><div class="metric"><strong>${scenarios.filter((scenario) => scenario.status === "ready").length}</strong><span>Ready</span></div><div class="metric"><strong>${scenarios.filter((scenario) => scenario.status === "archived").length}</strong><span>Archived</span></div></div>`;
}

function renderScenarioTable(scenarios: readonly Scenario[]): string {
  if (scenarios.length === 0)
    return '<p class="empty">No scenarios yet. Start with a bounded demand or migration shock.</p>';
  return `<div class="table-wrap"><table><caption>Tenant-scoped scenario inputs. Raw credentials and source files are never rendered.</caption><thead><tr><th scope="col">Scenario</th><th scope="col">Status</th><th scope="col">Base forecast</th><th scope="col">Shock fields</th><th scope="col">Updated</th></tr></thead><tbody>${scenarios.map((scenario) => `<tr><td><a href="/scenarios/${escapeHtml(scenario.id)}">${escapeHtml(scenario.name)}</a>${scenario.description ? `<div class="help">${escapeHtml(scenario.description)}</div>` : ""}</td><td><span class="status ${escapeHtml(scenario.status)}">${escapeHtml(scenario.status)}</span></td><td class="mono">${scenario.base_forecast_run_id ? escapeHtml(scenario.base_forecast_run_id) : "Not linked"}</td><td>${Object.keys(scenario.shock_config).length} configured</td><td class="mono">${escapeHtml(scenario.updated_at)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderCreateForm(csrfToken: string | undefined): string {
  return `<section aria-labelledby="new-scenario"><h2 id="new-scenario">Create a draft</h2><form method="post" action="/scenarios"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken ?? "")}"><div class="field"><label for="scenario-name">Name</label><input id="scenario-name" name="name" required maxlength="200" autocomplete="off"></div><div class="field"><label for="scenario-description">Description</label><textarea id="scenario-description" name="description" maxlength="2000"></textarea></div><div class="field"><label for="scenario-shock">Shock configuration (JSON)</label><textarea id="scenario-shock" name="shock_config" required>{"demand_growth_pct":"10.00"}</textarea><p class="help">Keep values as exact strings where precision matters.</p></div><div class="actions"><button type="submit">Save draft scenario</button></div></form></section>`;
}

function renderShockConfig(config: Record<string, unknown>): string {
  const entries = Object.entries(config);
  if (entries.length === 0)
    return '<p class="notice">No shock fields configured. This draft is a neutral baseline.</p>';
  return `<div class="table-wrap"><table><caption>Structured shock inputs.</caption><thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead><tbody>${entries.map(([key, value]) => `<tr><th scope="row" class="mono">${escapeHtml(key)}</th><td class="mono">${escapeHtml(displayValue(value))}</td></tr>`).join("")}</tbody></table></div>`;
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unavailable]";
  }
}

function nullable(value: string | null): string {
  return value ? escapeHtml(value) : '<span class="help">No description supplied.</span>';
}
