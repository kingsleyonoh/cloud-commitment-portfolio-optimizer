import type { RecommendationDetail } from "../../core/recommendations/recommendations-types.js";
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
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(20rem,3fr);gap:1rem;align-items:start}.panel,.rail{border:1px solid var(--rule);background:var(--surface);border-radius:.375rem;padding:1rem}.panel h2,.rail h2{margin:0 0 .75rem}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0}.metric{border-top:3px solid var(--cyan);background:var(--raised);padding:.85rem}.metric strong{display:block;font:700 1.35rem/1 ui-monospace,monospace}.metric span{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}caption{text-align:left;color:var(--muted);margin-bottom:.5rem}th,td{padding:.7rem;border-top:1px solid var(--rule);text-align:left;vertical-align:top}.num,.mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.status{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.15rem .5rem}.ready,.low{color:#bde8dc}.medium,.pending_approval{color:#f3d39b}.high,.blocked{color:#f0c7c2}.notice{border-left:4px solid var(--amber);background:rgb(231 173 69 / .08);padding:.85rem;color:#f3d39b}.help{margin:.25rem 0 0;color:var(--muted);font-size:.9rem}.rail ol{margin:0;padding-left:1.25rem}.rail li{margin:.7rem 0}
@media (max-width:860px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:9rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function renderRecommendationDetailPage(detail: RecommendationDetail): string {
  const recommendation = detail.recommendation;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>Recommendation report | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#recommendation">Skip to recommendation</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<div class="context">${escapeHtml(recommendation.status)} · ${escapeHtml(recommendation.risk_band)}</div>
</header>
<main id="recommendation">
<p class="eyebrow">CFO decision packet</p>
<h1>Recommendation report</h1>
<p class="lede">Review expected savings, downside exposure, utilization confidence, and immutable report readiness before any commitment decision leaves the optimizer.</p>
<div class="metrics" aria-label="Recommendation economics">
<div class="metric"><strong>${formatCents(recommendation.expected_savings_cents)}</strong><span>Expected net saving</span></div>
<div class="metric"><strong>${formatCents(recommendation.p95_downside_loss_cents)}</strong><span>p95 downside</span></div>
<div class="metric"><strong>${escapeHtml(recommendation.confidence_score)}</strong><span>Confidence score</span></div>
<div class="metric"><strong>${formatCents(recommendation.commitment_amount_cents)}</strong><span>Commitment amount</span></div>
</div>
<div class="grid">
<section class="panel" aria-labelledby="decision-summary">
<h2 id="decision-summary">Decision summary</h2>
<div class="table-wrap"><table><caption>Non-approval P1 recommendation detail.</caption><tbody>
<tr><th scope="row">Recommendation</th><td>${escapeHtml(labelType(recommendation.recommendation_type))}</td></tr>
<tr><th scope="row">Provider/instrument</th><td>${escapeHtml(recommendation.provider)} · ${escapeHtml(labelInstrument(recommendation.instrument))}</td></tr>
<tr><th scope="row">Service/region</th><td>${escapeHtml(recommendation.service_code)} · ${escapeHtml(recommendation.region)}</td></tr>
<tr><th scope="row">Term</th><td>${recommendation.term_months} months</td></tr>
<tr><th scope="row">Status</th><td><span class="status ${escapeHtml(recommendation.status)}">${escapeHtml(recommendation.status)}</span></td></tr>
<tr><th scope="row">Risk band</th><td><span class="status ${escapeHtml(recommendation.risk_band)}">${escapeHtml(recommendation.risk_band)}</span></td></tr>
<tr><th scope="row">Utilization p50/p95</th><td class="mono">${escapeHtml(recommendation.utilization_p50_pct)}% / ${escapeHtml(recommendation.utilization_p95_pct)}%</td></tr>
</tbody></table></div>
${renderExplanation(recommendation.explanation)}
</section>
<aside class="rail" aria-labelledby="report-state">
<h2 id="report-state">Immutable report state</h2>
${renderReportState(detail)}
<ol>
<li>No-action baseline and optimizer explanation stay visible with the financial metrics.</li>
<li>Expected saving is paired with downside loss; neither is shown alone.</li>
<li>P1 report detail excludes approval workflow handling until that workflow ships.</li>
</ol>
</aside>
</div>
</main>
</body>
</html>`;
}

function renderReportState(detail: RecommendationDetail): string {
  if (!detail.report_summary) {
    return '<p class="notice">Report snapshot not generated yet. Use the report API to freeze an immutable recommendation_report:v1 snapshot.</p>';
  }
  return `<p><span class="status ready">${escapeHtml(detail.report_summary.status)}</span></p>
<p class="help">Snapshot ${escapeHtml(detail.report_summary.id)} was created ${escapeHtml(detail.report_summary.created_at)}. Rendered object locations stay server-side.</p>`;
}

function renderExplanation(explanation: Record<string, unknown>): string {
  if (Object.keys(explanation).length === 0)
    return '<p class="notice">No optimizer explanation provided.</p>';
  return `<h3>Optimizer explanation</h3><div class="table-wrap"><table><tbody>${Object.entries(
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

function formatCents(value: string): string {
  const cents = Number.parseInt(value, 10);
  if (!Number.isFinite(cents)) return escapeHtml(value);
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
  return instrument;
}
