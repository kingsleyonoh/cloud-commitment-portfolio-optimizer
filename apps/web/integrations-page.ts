import type { AdapterStatus, EcosystemTarget } from "../../core/adapters/ecosystem-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,button:focus-visible,select:focus-visible{outline:0;box-shadow:var(--focus)}.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.mono{font-family:ui-monospace,monospace}.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.ready{color:#bde8dc}.disabled,.unsupported{color:#aeb8bd}.degraded{color:#f3d39b}.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.field{display:grid;gap:.4rem;margin-top:1rem}label{font-weight:700}select{min-height:44px;border:1px solid var(--rule);border-radius:.25rem;background:#0d1821;color:var(--ink);padding:.7rem .8rem;font:inherit}button{min-height:44px;border:0;border-radius:.25rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;font-weight:800;cursor:pointer}.actions{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-top:1rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:860px){.grid{grid-template-columns:1fr}th,td{min-width:12rem}}@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export interface IntegrationsPageOptions {
  integrations: readonly AdapterStatus[];
  role: UserRole;
  csrfToken?: string | undefined;
}

export function renderIntegrationsPage(options: IntegrationsPageOptions): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><title>Integrations | ${PRODUCT_NAME}</title><style>${STYLES}</style></head>
<body><a class="skip" href="#integrations">Skip to integrations</a><header class="masthead"><div class="brand">${PRODUCT_NAME}</div><div class="context">${escapeHtml(options.role)} · optional adapters</div></header><main id="integrations"><p class="eyebrow">Optional ecosystem edges</p><h1>Integrations</h1><p class="lede">Inspect external adapter readiness without putting the optimizer behind a remote service. Local recommendations, approvals, reports, and notifications remain canonical.</p><div class="grid"><section class="panel" aria-labelledby="integration-status"><h2 id="integration-status">Adapter status</h2>${renderTable(options.integrations)}</section><aside class="rail" aria-labelledby="integration-controls"><h2 id="integration-controls">Test an adapter</h2><p class="help">A test writes a tenant-scoped outbound event. The worker sends it only when that adapter is enabled and configured.</p><form method="post" action="/integrations/test-event"><input type="hidden" name="_csrf" value="${escapeHtml(options.csrfToken ?? "")}"><div class="field"><label for="target-system">Target system</label><select id="target-system" name="target_system">${options.integrations.map((integration) => `<option value="${escapeHtml(integration.target_system)}">${escapeHtml(label(integration.target_system))}</option>`).join("")}</select></div><div class="actions"><button type="submit">Queue test event</button></div></form><ol><li>Disabled adapters create no outbound HTTP calls.</li><li>Degraded means configuration is incomplete; fix env values before enabling.</li><li>Invoice Reconciliation stays unsupported until its endpoint contract is verified.</li></ol></aside></div></main></body></html>`;
}

function renderTable(integrations: readonly AdapterStatus[]): string {
  return `<div class="table-wrap"><table><caption>Runtime adapter readiness; API keys and remote response bodies are never rendered.</caption><thead><tr><th scope="col">Target</th><th scope="col">Enabled</th><th scope="col">Configured</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead><tbody>${integrations.map((integration) => `<tr><th scope="row">${escapeHtml(label(integration.target_system))}</th><td>${integration.enabled ? "yes" : "no"}</td><td>${integration.configured ? "yes" : "no"}</td><td><span class="status ${escapeHtml(integration.state)}">${escapeHtml(integration.state)}</span></td><td>${escapeHtml(integration.detail)}</td></tr>`).join("")}</tbody></table></div>`;
}

function label(target: EcosystemTarget): string {
  if (target === "notification_hub") return "Notification Hub";
  if (target === "workflow_engine") return "Workflow Engine";
  return "Invoice Reconciliation";
}
