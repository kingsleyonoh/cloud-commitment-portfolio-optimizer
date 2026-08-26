import type { ApiKeyMetadata } from "../../core/tenant/api-key-metadata-types.js";
import type { TenantProfile } from "../../core/tenant/registration-types.js";
import type { TenantUser } from "../../core/tenant/users-types.js";
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
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.column{display:grid;gap:1rem}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin:1rem 0}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.35rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.active{color:#bde8dc}.inactive,.revoked{color:#f0c7c2}.current{color:#bde8dc}.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export interface SettingsPageModel {
  profile: TenantProfile;
  users: TenantUser[];
  apiKeys: ApiKeyMetadata[];
}

export function renderSettingsPage(model: SettingsPageModel): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Settings | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#settings">Skip to settings</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(model.profile.display_name)} · admin settings</div>
</header>
<main id="settings">
<p class="eyebrow">Tenant control plane</p>
<h1>Settings</h1>
<p class="lede">Review tenant identity, risk defaults, active users, and API-key metadata before operating commitment workflows.</p>
<div class="metrics" aria-label="Settings summary">
<div class="metric"><strong>${model.users.length}</strong><span>Visible users</span></div>
<div class="metric"><strong>${model.apiKeys.filter((key) => !key.revoked_at).length}</strong><span>Current API keys</span></div>
<div class="metric"><strong>${formatCents(model.profile.risk_budget_cents)}</strong><span>Risk budget</span></div>
</div>
<div class="grid">
<div class="column">
<section class="panel" aria-labelledby="tenant-identity">
<h2 id="tenant-identity">Tenant identity</h2>
<div class="table-wrap"><table><caption>Canonical tenant metadata.</caption><tbody>
<tr><th scope="row">Display name</th><td>${escapeHtml(model.profile.display_name)}</td></tr>
<tr><th scope="row">Legal name</th><td>${escapeHtml(model.profile.legal_name)}</td></tr>
<tr><th scope="row">Full legal name</th><td>${escapeHtml(model.profile.full_legal_name)}</td></tr>
<tr><th scope="row">Contact email</th><td>${nullable(model.profile.contact_email)}</td></tr>
<tr><th scope="row">Finance owner</th><td>${nullable(model.profile.finance_owner_email)}</td></tr>
<tr><th scope="row">Support URL</th><td>${nullable(model.profile.support_url)}</td></tr>
</tbody></table></div>
</section>
<section class="panel" aria-labelledby="tenant-users">
<h2 id="tenant-users">Tenant users</h2>
${renderUsers(model.users)}
</section>
<section class="panel" aria-labelledby="api-keys">
<h2 id="api-keys">API-key inventory</h2>
${renderApiKeys(model.apiKeys)}
</section>
</div>
<aside class="rail" aria-labelledby="risk-defaults">
<h2 id="risk-defaults">Risk defaults</h2>
<p class="help">These defaults anchor optimizer policy review and CFO-facing recommendation context.</p>
<div class="table-wrap"><table><tbody>
<tr><th scope="row">Currency</th><td class="mono">${escapeHtml(model.profile.default_currency)}</td></tr>
<tr><th scope="row">Timezone</th><td class="mono">${escapeHtml(model.profile.timezone)}</td></tr>
<tr><th scope="row">Risk budget</th><td class="mono">${formatCents(model.profile.risk_budget_cents)}</td></tr>
</tbody></table></div>
<ol>
<li>User and API-key management stays tenant-admin-only.</li>
<li>API keys show metadata only; raw key material is never rendered.</li>
<li>Registration identifiers remain server-side unless a dedicated profile editor ships.</li>
</ol>
</aside>
</div>
</main>
</body>
</html>`;
}

function renderUsers(users: TenantUser[]): string {
  if (users.length === 0) return '<p class="notice">No users are visible for this tenant.</p>';
  return `<div class="table-wrap"><table><caption>Tenant-scoped user inventory.</caption><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Updated</th></tr></thead><tbody>${users
    .map(
      (user) =>
        `<tr><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td class="mono">${escapeHtml(user.role)}</td><td><span class="status ${user.is_active ? "active" : "inactive"}">${user.is_active ? "active" : "inactive"}</span></td><td class="mono">${escapeHtml(user.updated_at)}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function renderApiKeys(keys: ApiKeyMetadata[]): string {
  if (keys.length === 0) return '<p class="notice">No API keys are visible for this tenant.</p>';
  return `<div class="table-wrap"><table><caption>Metadata-only API-key inventory.</caption><thead><tr><th>Key id</th><th>Note</th><th>Status</th><th>Created</th><th>Revoked</th></tr></thead><tbody>${keys
    .map((key) => {
      const current = !key.revoked_at;
      return `<tr><td class="mono">${escapeHtml(shortId(key.id))}</td><td>${nullable(key.note)}</td><td><span class="status ${current ? "current" : "revoked"}">${current ? "current" : "revoked"}</span></td><td class="mono">${escapeHtml(key.created_at)}</td><td class="mono">${nullable(key.revoked_at)}</td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function nullable(value: string | null): string {
  return value ? escapeHtml(value) : '<span class="help">Not set</span>';
}

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatCents(value: string): string {
  const cents = Number.parseInt(value, 10);
  if (!Number.isFinite(cents)) return escapeHtml(value);
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
