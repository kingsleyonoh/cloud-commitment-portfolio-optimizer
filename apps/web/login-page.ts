import type { AppError } from "../../core/shared/errors.js";

export interface LoginPageValues {
  tenantId?: string;
  email?: string;
}

export interface LoginPageOptions {
  error?: Pick<AppError, "message">;
  values?: LoginPageValues;
}

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}
body{margin:0;min-height:100vh;background:linear-gradient(135deg,#0a1118 0%,#111c26 58%,#0a1118 100%);font-size:16px;line-height:1.5}
a{color:var(--cyan)}a:focus-visible,button:focus-visible,input:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}
main{min-height:100vh;display:grid;align-items:center;padding:clamp(1.5rem,5vw,5rem)}
.shell{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:clamp(2rem,5vw,5rem);max-width:82rem;margin:0 auto;width:100%}
.eyebrow{margin:0 0 1rem;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}
h1{max-width:12ch;margin:0;font:600 clamp(3rem,9vw,6rem)/.94 Georgia,serif;letter-spacing:-.045em}
.lede{max-width:42rem;color:var(--muted);font-size:clamp(1rem,2vw,1.22rem);margin:1.5rem 0 0}
.boundary{margin-top:2rem;padding:1rem 1.25rem;border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);color:#f3d39b}
.panel{background:rgb(17 28 38 / .9);border:1px solid var(--rule);box-shadow:0 12px 36px rgb(0 0 0 / .24);border-radius:.375rem;padding:1.25rem}
.alert{margin:0 0 1rem;padding:.85rem 1rem;border-left:4px solid var(--danger);background:rgb(208 106 98 / .12);color:#f0c7c2}
.field{display:grid;gap:.4rem;margin-top:1rem}label{font-weight:700}input{min-height:44px;width:100%;border:1px solid var(--rule);border-radius:.25rem;background:#0d1821;color:var(--ink);padding:.7rem .8rem;font:inherit}
.help{margin:.2rem 0 0;color:var(--muted);font-size:.9rem}.actions{display:flex;align-items:center;gap:1rem;margin-top:1.25rem;flex-wrap:wrap}
button{min-height:44px;border:0;border-radius:.25rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;font-weight:800;cursor:pointer}.meta{margin-top:1rem;color:var(--muted);font-size:.9rem}
@media (max-width:760px){.shell{grid-template-columns:1fr}h1{max-width:10ch}.panel{padding:1rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderLoginPage(options: LoginPageOptions = {}): string {
  const values = options.values ?? {};
  const alert = options.error
    ? `<div class="alert" role="alert" tabindex="-1"><strong>Login failed.</strong> ${escapeHtml(
        options.error.message,
      )}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Login | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#login-form">Skip to login form</a>
<main>
<div class="shell">
<section aria-labelledby="login-title">
<p class="eyebrow">${PRODUCT_NAME} · JWT session</p>
<h1 id="login-title">Open the underwriting desk</h1>
<p class="lede">Sign in with a database-confirmed user account before viewing tenant-scoped cloud commitment data, forecasts, optimizer runs, and reports.</p>
<p class="boundary">API keys are for analyst automation. They can call approved APIs, but they do not become an admin browser session and cannot manage users, keys, settings, or approvals.</p>
</section>
<section class="panel" aria-labelledby="form-title">
<h2 id="form-title">JWT user login</h2>
${alert}
<form id="login-form" method="post" action="/login" novalidate>
<div class="field">
<label for="tenant_id">Tenant ID</label>
<input id="tenant_id" name="tenant_id" autocomplete="organization" required value="${escapeHtml(
    values.tenantId ?? "",
  )}">
<p class="help">Use the tenant UUID from first-run setup or your administrator.</p>
</div>
<div class="field">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(
    values.email ?? "",
  )}">
</div>
<div class="field">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
</div>
<div class="actions">
<button type="submit">Create JWT session</button>
</div>
<p class="meta">Session cookies are HTTP-only where required and responses never render credentials, signed session values, hashes, or raw API keys.</p>
</form>
</section>
</div>
</main>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}
