import type { Approval, ApprovalDetail } from "../../core/approvals/approvals-types.js";
import type { UserRole } from "../../core/tenant/request-context.js";
import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--teal:#3d9b83;--danger:#d06a62;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}
body{margin:0;background:var(--canvas);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,button:focus-visible,textarea:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}
.masthead{border-bottom:1px solid var(--rule);background:#0d1821;padding:1rem clamp(1rem,4vw,2rem);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-weight:800}.context{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85rem}
main{max-width:96rem;margin:0 auto;padding:clamp(1rem,4vw,2rem)}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}
h1{margin:.5rem 0 0;font:600 clamp(2.25rem,6vw,4.5rem)/.95 Georgia,serif;letter-spacing:-.04em}.lede{max-width:58rem;color:var(--muted);font-size:1.08rem}
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.flow{display:grid;gap:1rem}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.35rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.num,.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.approved{color:#bde8dc}.pending,.queued{color:#f3d39b}.rejected,.expired,.failed{color:#f0c7c2}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.empty,.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.danger{border-left-color:var(--danger);color:#f0c7c2}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
.decision{display:grid;gap:.75rem;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--rule)}.decision label{font-weight:700}.decision textarea{min-height:7rem;width:100%;resize:vertical;border:1px solid var(--rule);border-radius:.25rem;background:#0d1821;color:var(--ink);padding:.7rem .8rem;font:inherit}.actions{display:flex;gap:.75rem;flex-wrap:wrap}.actions button{min-height:44px;border:0;border-radius:.25rem;padding:.75rem 1rem;font-weight:800;cursor:pointer}.approve{background:var(--cyan);color:#061016}.reject{background:transparent;color:#f0c7c2;border:1px solid var(--danger)!important}.back{display:inline-block;margin-bottom:1rem}.seal{font-family:ui-monospace,monospace;color:var(--teal)}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}.actions{display:grid}.actions button{width:100%}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export interface ApprovalsPageOptions {
  approvals: readonly Approval[];
  role: UserRole;
  csrfToken?: string | undefined;
}

export interface ApprovalDetailPageOptions {
  detail: ApprovalDetail;
  role: UserRole;
  csrfToken?: string | undefined;
}

export function renderApprovalsPage(options: ApprovalsPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Approvals | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#approvals">Skip to approvals</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)} · finance control</div>
</header>
<main id="approvals">
<p class="eyebrow">Finance decision desk</p>
<h1>Finance approval queue</h1>
<p class="lede">Review the frozen recommendation packet, pair expected savings with p95 downside, and record an explicit decision before a commitment leaves the tenant.</p>
${renderQueue(options.approvals)}
</main>
</body>
</html>`;
}

export function renderApprovalDetailPage(options: ApprovalDetailPageOptions): string {
  const { approval, recommendation } = options.detail;
  const packetRecommendation = nestedRecord(approval.approval_snapshot, "recommendation");
  const snapshotApproval = nestedRecord(approval.approval_snapshot, "approval");
  const requestReason = valueAt(snapshotApproval, "request_reason");
  const assignedTo = valueAt(snapshotApproval, "assigned_to");
  const expectedSavings = recommendationValue(
    packetRecommendation,
    "expected_savings_cents",
    recommendation.expected_savings_cents,
  );
  const downside = recommendationValue(
    packetRecommendation,
    "p95_downside_loss_cents",
    recommendation.p95_downside_loss_cents,
  );
  const confidence = recommendationValue(
    packetRecommendation,
    "confidence_score",
    recommendation.confidence_score,
  );
  const commitment = recommendationValue(
    packetRecommendation,
    "commitment_amount_cents",
    recommendation.commitment_amount_cents,
  );
  const provider = recommendationValue(packetRecommendation, "provider", recommendation.provider);
  const instrument = recommendationValue(
    packetRecommendation,
    "instrument",
    recommendation.instrument,
  );
  const serviceCode = recommendationValue(
    packetRecommendation,
    "service_code",
    recommendation.service_code,
  );
  const region = recommendationValue(packetRecommendation, "region", recommendation.region);
  const termMonths = recommendationNumber(
    packetRecommendation,
    "term_months",
    recommendation.term_months,
  );
  const recommendationStatus = recommendationValue(
    packetRecommendation,
    "status",
    recommendation.status,
  );
  const riskBand = recommendationValue(packetRecommendation, "risk_band", recommendation.risk_band);
  const utilizationP50 = recommendationValue(
    packetRecommendation,
    "utilization_p50_pct",
    recommendation.utilization_p50_pct,
  );
  const utilizationP95 = recommendationValue(
    packetRecommendation,
    "utilization_p95_pct",
    recommendation.utilization_p95_pct,
  );
  const explanation = nestedRecord(packetRecommendation, "explanation");
  const csrf = escapeHtml(options.csrfToken ?? "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Approval decision | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#approval-detail">Skip to approval detail</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(options.role)} · ${escapeHtml(approval.status)}</div>
</header>
<main id="approval-detail">
<a class="back" href="/approvals">← Back to approval queue</a>
<p class="eyebrow">Frozen finance packet</p>
<h1>Approval decision packet</h1>
<p class="lede">This review combines the immutable approval snapshot with the recommendation economics. The packet remains the source of truth after live tenant or price-table edits.</p>
<div class="metrics" aria-label="Approval economics">
<div class="metric"><strong>${formatCents(expectedSavings)}</strong><span>Expected net saving</span></div>
<div class="metric"><strong>${formatCents(downside)}</strong><span>p95 downside</span></div>
<div class="metric"><strong>${escapeHtml(confidence)}</strong><span>Confidence score</span></div>
<div class="metric"><strong>${formatCents(commitment)}</strong><span>Commitment amount</span></div>
</div>
<div class="grid">
<div class="flow">
<section class="panel" aria-labelledby="recommendation-summary">
<h2 id="recommendation-summary">Recommendation summary</h2>
<div class="table-wrap"><table><caption>Tenant-scoped recommendation economics.</caption><tbody>
<tr><th scope="row">Type</th><td>${escapeHtml(labelType(recommendationValue(packetRecommendation, "type", recommendation.recommendation_type)))}</td></tr>
<tr><th scope="row">Provider/instrument</th><td>${escapeHtml(provider)} · ${escapeHtml(labelInstrument(instrument))}</td></tr>
<tr><th scope="row">Service/region</th><td>${escapeHtml(serviceCode)} · ${escapeHtml(region)}</td></tr>
<tr><th scope="row">Term</th><td>${termMonths} months</td></tr>
<tr><th scope="row">Status</th><td><span class="status ${escapeHtml(recommendationStatus)}">${escapeHtml(recommendationStatus)}</span></td></tr>
<tr><th scope="row">Risk band</th><td><span class="status ${escapeHtml(riskBand)}">${escapeHtml(riskBand)}</span></td></tr>
<tr><th scope="row">Utilization p50/p95</th><td class="mono">${escapeHtml(utilizationP50)}% / ${escapeHtml(utilizationP95)}%</td></tr>
</tbody></table></div>
${renderExplanation(Object.keys(explanation).length > 0 ? explanation : recommendation.explanation)}
</section>
<section class="panel" aria-labelledby="approval-record">
<h2 id="approval-record">Approval record</h2>
<div class="table-wrap"><table><caption>Immutable packet and decision lifecycle.</caption><tbody>
<tr><th scope="row">Packet contract</th><td class="seal">${escapeHtml(valueAt(approval.approval_snapshot, "contract_version") || "approval_packet:v1")}</td></tr>
<tr><th scope="row">Approval status</th><td><span class="status ${escapeHtml(approval.status)}">${escapeHtml(approval.status)}</span></td></tr>
<tr><th scope="row">Requested</th><td class="mono">${escapeHtml(approval.requested_at)}</td></tr>
<tr><th scope="row">Expires</th><td class="mono">${escapeHtml(approval.expires_at)}</td></tr>
<tr><th scope="row">Assigned</th><td>${escapeHtml(assignedTo || "Finance queue")}</td></tr>
<tr><th scope="row">Request reason</th><td>${escapeHtml(requestReason || "No request reason recorded.")}</td></tr>
<tr><th scope="row">Decision reason</th><td>${escapeHtml(approval.decision_reason || "Not decided.")}</td></tr>
</tbody></table></div>
${renderDecision(approval, csrf)}
</section>
</div>
<aside class="rail" aria-labelledby="approval-guidance">
<h2 id="approval-guidance">Decision guardrails</h2>
<p class="help">A decision changes both the approval and its linked recommendation atomically. Expired and terminal approvals remain immutable.</p>
<ol>
<li>Read expected savings and p95 downside together.</li>
<li>Check the risk band, utilization confidence, and binding constraints.</li>
<li>Record a concise business reason for the audit trail.</li>
</ol>
<p class="seal">Snapshot ${escapeHtml(approval.id)} · server-rendered</p>
</aside>
</div>
</main>
</body>
</html>`;
}

function renderQueue(approvals: readonly Approval[]): string {
  const pending = approvals.filter((approval) => approval.status === "pending").length;
  const expired = approvals.filter((approval) => approval.status === "expired").length;
  const decided = approvals.filter((approval) =>
    ["approved", "rejected"].includes(approval.status),
  ).length;
  return `<div class="grid">
<section class="panel" aria-labelledby="approval-list">
<h2 id="approval-list">Decision inventory</h2>
<div class="metrics" aria-label="Approval status summary">
<div class="metric"><strong>${approvals.length}</strong><span>Total packets</span></div>
<div class="metric"><strong>${pending}</strong><span>Pending decision</span></div>
<div class="metric"><strong>${expired}</strong><span>Expired</span></div>
<div class="metric"><strong>${decided}</strong><span>Terminal decisions</span></div>
</div>
${approvals.length === 0 ? '<p class="empty">No approval packets are waiting. Recommendations remain in the local queue until a high-value decision is requested.</p>' : renderApprovalTable(approvals)}
</section>
<aside class="rail" aria-labelledby="queue-guidance">
<h2 id="queue-guidance">Queue guidance</h2>
<p class="help">Approval packets carry the recommendation economics and tenant context frozen at request time.</p>
<ol>
<li>Pending is actionable only while the expiry window is open.</li>
<li>Expired, approved, and rejected packets remain visible for review.</li>
<li>Only Finance Approver and Tenant Admin users can decide.</li>
</ol>
</aside>
</div>`;
}

function renderApprovalTable(approvals: readonly Approval[]): string {
  const rows = approvals.map((approval) => {
    const recommendation = nestedRecord(approval.approval_snapshot, "recommendation");
    const expected = valueAt(recommendation, "expected_savings_cents");
    const downside = valueAt(recommendation, "p95_downside_loss_cents");
    const risk = valueAt(recommendation, "risk_band");
    const assigned = valueAt(nestedRecord(approval.approval_snapshot, "approval"), "assigned_to");
    return `<tr>
<td><span class="status ${escapeHtml(approval.status)}">${escapeHtml(approval.status)}</span></td>
<td><a href="/approvals/${escapeHtml(approval.id)}">Review decision</a><div class="mono help">${escapeHtml(approval.id)}</div></td>
<td>${escapeHtml(labelInstrument(valueAt(recommendation, "instrument")))}</td>
<td class="num"><span class="help">Expected net saving</span><br>${formatCents(expected)}<br><span class="help">p95 downside ${formatCents(downside)}</span></td>
<td>${escapeHtml(risk || "Not scored")}</td>
<td>${escapeHtml(assigned || "Finance queue")}<br><span class="mono help">expires ${escapeHtml(approval.expires_at)}</span></td>
</tr>`;
  });
  return `<div class="table-wrap"><table><caption>Tenant-scoped approval packets. Savings and downside stay paired.</caption><thead><tr><th scope="col">Status</th><th scope="col">Packet</th><th scope="col">Instrument</th><th scope="col">Economics</th><th scope="col">Risk</th><th scope="col">Assignment/expiry</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function renderDecision(approval: Approval, csrf: string): string {
  if (approval.status !== "pending") {
    return '<p class="notice">Decision recorded. This approval packet is terminal and cannot be changed.</p>';
  }
  return `<div class="decision" aria-labelledby="decision-title">
<h3 id="decision-title">Record a decision</h3>
<p class="help">A reason is required and will be stored with the approval transition.</p>
<form method="post" action="/approvals/${escapeHtml(approval.id)}/approve">
<input type="hidden" name="_csrf" value="${csrf}">
<label for="approve-reason">Approval reason</label>
<textarea id="approve-reason" name="decision_reason" minlength="1" maxlength="2000" required></textarea>
<div class="actions"><button class="approve" type="submit">Approve recommendation</button></div>
</form>
<form method="post" action="/approvals/${escapeHtml(approval.id)}/reject">
<input type="hidden" name="_csrf" value="${csrf}">
<label for="reject-reason">Rejection reason</label>
<textarea id="reject-reason" name="decision_reason" minlength="1" maxlength="2000" required></textarea>
<div class="actions"><button class="reject" type="submit">Reject recommendation</button></div>
</form>
</div>`;
}

function renderExplanation(explanation: Record<string, unknown>): string {
  if (Object.keys(explanation).length === 0)
    return '<p class="notice">No optimizer explanation provided.</p>';
  return `<h3>Binding constraints and rationale</h3><div class="table-wrap"><table><tbody>${Object.entries(
    explanation,
  )
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(summarize(value))}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function summarize(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : {};
}

function valueAt(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  return result === undefined || result === null ? "" : String(result);
}

function recommendationValue(
  snapshot: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  return valueAt(snapshot, key) || fallback;
}

function recommendationNumber(
  snapshot: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = Number.parseInt(valueAt(snapshot, key), 10);
  return Number.isFinite(value) ? value : fallback;
}

function formatCents(value: string): string {
  const cents = Number.parseInt(value, 10);
  if (!Number.isFinite(cents)) return escapeHtml(value || "—");
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function labelType(type: string): string {
  if (type === "buy") return "Buy commitment";
  if (type === "manual_review") return "Manual review";
  if (type === "no_action") return "No action";
  return type;
}

function labelInstrument(instrument: string): string {
  if (instrument === "aws_compute_savings_plan") return "AWS Compute Savings Plan";
  if (!instrument) return "Unknown instrument";
  return instrument;
}
