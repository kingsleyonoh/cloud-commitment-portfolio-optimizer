import type { NotificationPreference } from "../../core/notifications/notifications-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const EVENTS = [
  { eventType: "cloud_commitment.approval.requested", urgency: "high" },
  { eventType: "cloud_commitment.approval.decided", urgency: "medium" },
  { eventType: "cloud_commitment.import.completed", urgency: "low" },
  { eventType: "cloud_commitment.import.quarantined", urgency: "medium" },
  { eventType: "cloud_commitment.adapter.failed", urgency: "high" },
] as const;
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,button:focus-visible,input:focus-visible{outline:0;box-shadow:var(--focus)}.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.mono{font-family:ui-monospace,monospace}.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.enabled{color:#bde8dc}.disabled{color:#f3d39b}.locked{color:#f0c7c2}.row-control{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}.row-control input{width:1.25rem;height:1.25rem;accent-color:var(--cyan)}button{min-height:44px;border:0;border-radius:.25rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;font-weight:800;cursor:pointer}.actions{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-top:1rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:860px){.grid{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:11rem}}@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export interface NotificationSettingsPageOptions {
  preferences: readonly NotificationPreference[];
  role: UserRole;
  csrfToken?: string | undefined;
}

export function renderNotificationSettingsPage(options: NotificationSettingsPageOptions): string {
  const current = new Map(
    options.preferences.map((preference) => [
      `${preference.event_type}\0${preference.channel}`,
      preference,
    ]),
  );
  const rows = EVENTS.map((event) => {
    const preference = current.get(`${event.eventType}\0in_app`);
    return {
      eventType: event.eventType,
      urgency: preference?.urgency ?? event.urgency,
      enabled: preference?.enabled ?? true,
      lockedByAdmin: preference?.locked_by_admin ?? false,
    };
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><title>Notification Settings | ${PRODUCT_NAME}</title><style>${STYLES}</style></head>
<body><a class="skip" href="#notification-settings">Skip to notification settings</a><header class="masthead"><div class="brand">${PRODUCT_NAME}</div><div class="context">${escapeHtml(options.role)} · notification controls</div></header><main id="notification-settings"><p class="eyebrow">In-app delivery</p><h1>Notification settings</h1><p class="lede">Choose which local in-app events should interrupt your workflow. Preferences are tenant-scoped to your user; required high-urgency notices remain admin-controlled.</p><div class="grid"><section class="panel" aria-labelledby="preference-table"><h2 id="preference-table">Event preferences</h2><form method="post" action="/settings/notifications"><input type="hidden" name="_csrf" value="${escapeHtml(options.csrfToken ?? "")}"><div class="table-wrap"><table><caption>Local in-app preference overrides. Email delivery is not enabled by the core application.</caption><thead><tr><th scope="col">Event</th><th scope="col">Urgency</th><th scope="col">Enabled</th><th scope="col">Control</th></tr></thead><tbody>${rows.map((row, index) => `<tr><th scope="row" class="mono">${escapeHtml(row.eventType)}<input type="hidden" name="event_type" value="${escapeHtml(row.eventType)}"><input type="hidden" name="urgency" value="${escapeHtml(row.urgency)}"><input type="hidden" name="channel" value="in_app"></th><td><span class="status ${escapeHtml(row.urgency)}">${escapeHtml(row.urgency)}</span></td><td><span class="status ${row.enabled ? "enabled" : "disabled"}">${row.enabled ? "enabled" : "muted"}</span></td><td><label class="row-control" for="enabled-${index}"><input id="enabled-${index}" name="enabled_${index}" type="checkbox" value="true"${row.enabled ? " checked" : ""}> Keep in-app</label>${row.lockedByAdmin ? '<span class="status locked">admin lock</span>' : ""}</td></tr>`).join("")}</tbody></table></div><div class="actions"><button type="submit">Save preferences</button></div></form></section><aside class="rail" aria-labelledby="preference-guidance"><h2 id="preference-guidance">Preference guardrails</h2><ol><li>Low and medium events can be muted per user.</li><li>High-urgency approval and risk notices require an explicit tenant-admin lock to mute.</li><li>Local preferences remain canonical when optional external adapters are disabled.</li></ol>${options.preferences.length === 0 ? '<p class="notice">No overrides are saved yet; the default is enabled for each listed event.</p>' : `<p class="help">${options.preferences.length} saved override(s) are active for this user.</p>`}</aside></div></main></body></html>`;
}
