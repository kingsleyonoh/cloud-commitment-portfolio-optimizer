import type { Audit } from "../../core/audit/audit-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--focus:0 0 0 3px rgb(66 198 215 / .45)}*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,input:focus-visible,button:focus-visible{outline:0;box-shadow:var(--focus)}.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}main{max-width:110rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}.panel{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem;margin-top:1rem}.filters{display:flex;gap:.75rem;align-items:end;flex-wrap:wrap}.field{display:grid;gap:.35rem}label{font-weight:700}input{min-height:44px;border:1px solid var(--rule);border-radius:.25rem;background:#0d1821;color:var(--ink);padding:.65rem .75rem;font:inherit}button{min-height:44px;border:0;border-radius:.25rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;font-weight:800;cursor:pointer}.secondary{background:var(--raised);color:var(--cyan);border:1px solid var(--rule)}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.92rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}.json{white-space:pre-wrap;overflow-wrap:anywhere;color:#d6e0e3}.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}
@media (max-width:860px){.filters{display:grid;grid-template-columns:1fr}.filters button{width:100%}th,td{min-width:10rem}}@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export interface AuditLogPageOptions {
  audit: readonly Audit[];
  role: UserRole;
}

export function renderAuditLogPage(options: AuditLogPageOptions): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><title>Audit Log | ${PRODUCT_NAME}</title><style>${STYLES}</style></head>
<body><a class="skip" href="#audit-log">Skip to audit log</a><header class="masthead"><div class="brand">${PRODUCT_NAME}</div><div class="context">${escapeHtml(options.role)} · append-only evidence</div></header><main id="audit-log"><p class="eyebrow">Tenant history</p><h1>Audit log</h1><p class="lede">Inspect safe, append-only evidence for authentication, key changes, and commitment workflow decisions. Raw credentials, headers, and request bodies are never shown.</p><section class="panel" aria-labelledby="audit-filters"><h2 id="audit-filters">Filter evidence</h2><form class="filters" method="get" action="/audit-log"><div class="field"><label for="action">Action</label><input id="action" name="action" maxlength="200" placeholder="user.login.succeeded"></div><div class="field"><label for="entity-type">Entity type</label><input id="entity-type" name="entity_type" maxlength="200" placeholder="user"></div><div class="field"><label for="actor-type">Actor type</label><input id="actor-type" name="actor_type" maxlength="20" placeholder="user"></div><button type="submit">Apply filters</button><a class="secondary" href="/api/audit-log">Export JSON</a></form></section><section class="panel" aria-labelledby="audit-entries"><h2 id="audit-entries">Recent entries</h2>${renderRows(options.audit)}</section></main></body></html>`;
}

function renderRows(rows: readonly Audit[]): string {
  if (rows.length === 0)
    return '<p class="notice">No audit entries match the current tenant and filters.</p>';
  return `<div class="table-wrap"><table><caption>Tenant-scoped append-only audit entries.</caption><thead><tr><th scope="col">Created</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Old values</th><th scope="col">New values</th><th scope="col">Request</th></tr></thead><tbody>${rows.map((row) => `<tr><td class="mono">${escapeHtml(row.created_at)}</td><td>${escapeHtml(row.actor_type)}${row.actor_user_id ? `<div class="mono">${escapeHtml(shortId(row.actor_user_id))}</div>` : ""}</td><td class="mono">${escapeHtml(row.action)}</td><td>${escapeHtml(row.entity_type)}${row.entity_id ? `<div class="mono">${escapeHtml(shortId(row.entity_id))}</div>` : ""}</td><td class="json">${formatValues(row.old_values)}</td><td class="json">${formatValues(row.new_values)}</td><td class="mono">${row.request_id ? escapeHtml(shortId(row.request_id)) : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

function formatValues(value: Record<string, unknown> | null): string {
  if (!value) return "—";
  try {
    return escapeHtml(JSON.stringify(value));
  } catch {
    return "—";
  }
}

function shortId(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}
