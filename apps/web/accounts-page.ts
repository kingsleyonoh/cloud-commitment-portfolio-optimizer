import type { CloudAccount } from "../../core/tenant/cloud-accounts-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

export interface AccountsPageOptions {
  accounts: readonly CloudAccount[];
  role: UserRole;
}

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--teal:#3d9b83;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}
body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}
.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}
main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}
h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.panel{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2{margin:0 0 .75rem}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.num,.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.active{color:#bde8dc}.inactive{color:#f0c7c2}
.empty,.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.field{display:grid;gap:.35rem;margin-top:.85rem}label{font-weight:700}input,select{min-height:44px;width:100%;border:1px solid var(--rule);border-radius:.25rem;background:#0d1821;color:var(--ink);padding:.7rem .8rem;font:inherit}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}button{min-height:44px;border:0;border-radius:.25rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;font-weight:800;margin-top:1rem}
@media (max-width:860px){.grid{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderAccountsPage(options: AccountsPageOptions): string {
  const admin = options.role === "tenant_admin";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Cloud accounts | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#accounts">Skip to cloud accounts</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)}</div>
</header>
<main id="accounts">
<p class="eyebrow">Evidence intake</p>
<h1>Cloud accounts</h1>
<p class="lede">Register billing scopes before importing usage. External provider identifiers are masked by default in the browser.</p>
<div class="grid">
<section class="panel" aria-labelledby="accounts-list">
<h2 id="accounts-list">Account inventory</h2>
${renderAccountsTable(options.accounts)}
</section>
<aside class="panel" aria-labelledby="account-management">
<h2 id="account-management">${admin ? "Tenant Admin management" : "Read-only access"}</h2>
${admin ? renderAdminForm() : renderReadOnlyNotice()}
</aside>
</div>
</main>
</body>
</html>`;
}

function renderAccountsTable(accounts: readonly CloudAccount[]): string {
  if (accounts.length === 0) {
    return '<p class="empty">No cloud accounts yet. Add one billing scope before importing provider usage.</p>';
  }
  const rows = accounts
    .map(
      (account) => `<tr>
<td>${escapeHtml(account.display_name)}</td>
<td>${escapeHtml(account.provider)}</td>
<td class="mono">${escapeHtml(maskExternalRef(account.external_ref))}</td>
<td>${escapeHtml(account.currency)}</td>
<td><span class="status ${account.is_active ? "active" : "inactive"}">${
        account.is_active ? "active" : "inactive"
      }</span></td>
<td class="mono">${escapeHtml(account.updated_at)}</td>
</tr>`,
    )
    .join("");
  return `<div class="table-wrap"><table><caption>Tenant-scoped cloud accounts. Provider references are masked.</caption><thead><tr><th scope="col">Display name</th><th scope="col">Provider</th><th scope="col">External ref</th><th scope="col">Currency</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderAdminForm(): string {
  return `<p class="help">Use this screen to prepare account metadata. Mutations are enforced by the JSON API with Tenant Admin authority.</p>
<form method="post" action="/api/cloud-accounts">
<div class="field">
<label for="provider">Provider</label>
<select id="provider" name="provider" required>
<option value="aws">AWS</option>
<option value="azure">Azure</option>
<option value="gcp">GCP</option>
</select>
</div>
<div class="field">
<label for="external_ref">External reference</label>
<input id="external_ref" name="external_ref" autocomplete="off" required>
<p class="help">Store account or billing-scope IDs only after verifying the tenant boundary.</p>
</div>
<div class="field">
<label for="display_name">Display name</label>
<input id="display_name" name="display_name" required>
</div>
<div class="field">
<label for="currency">Currency</label>
<input id="currency" name="currency" value="USD" maxlength="3" required>
</div>
<button type="submit">Create account through API</button>
</form>`;
}

function renderReadOnlyNotice(): string {
  return '<p class="notice">Read-only access. Tenant Admin authority is required to create, update, or deactivate cloud account metadata.</p>';
}

function maskExternalRef(value: string): string {
  const suffix = value.slice(-4);
  return `••••${suffix}`;
}
