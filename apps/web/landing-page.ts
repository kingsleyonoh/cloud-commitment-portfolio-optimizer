import { escapeHtml } from "./login-page.js";

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f4f1e8;--muted:#aeb8bd;--canvas:#0a1118;--surface:#111c26;--raised:#1a2a36;--rule:#31414c;--cyan:#42c6d7;--amber:#e7ad45;--teal:#3d9b83;--focus:0 0 0 3px rgb(66 198 215 / .45)}
*{box-sizing:border-box}html{font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;background:var(--canvas);color:var(--ink);scroll-behavior:smooth}
body{margin:0;background:radial-gradient(circle at 80% 0%,#173443 0,#0a1118 42%);font-size:16px;line-height:1.5}a{color:var(--cyan)}a:focus-visible,button:focus-visible{outline:0;box-shadow:var(--focus)}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--cyan);color:#061016;padding:.75rem 1rem;z-index:10}.skip:focus{top:1rem}
.masthead{max-width:88rem;margin:0 auto;padding:1.25rem clamp(1rem,4vw,3rem);display:flex;justify-content:space-between;gap:1rem;align-items:center}.brand{font-weight:800}.nav{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}.nav a{text-decoration:none}.nav .button{border:1px solid var(--cyan);border-radius:.25rem;padding:.6rem .85rem}
main{max-width:88rem;margin:0 auto;padding:0 clamp(1rem,4vw,3rem) 4rem}.hero{display:grid;grid-template-columns:minmax(0,7fr) minmax(18rem,3fr);gap:clamp(2rem,6vw,7rem);align-items:end;padding:clamp(4rem,12vw,10rem) 0 5rem}.eyebrow{margin:0;color:var(--cyan);font:.76rem/1.2 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}h1{max-width:11ch;margin:.75rem 0 0;font:600 clamp(3rem,8vw,7rem)/.92 Georgia,serif;letter-spacing:-.05em}.lede{max-width:46rem;color:var(--muted);font-size:clamp(1.05rem,2vw,1.3rem)}.actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-top:1.75rem}.button{display:inline-block;min-height:44px;padding:.75rem 1rem;border-radius:.25rem;background:var(--cyan);color:#061016;font-weight:800;text-decoration:none}.button.secondary{background:transparent;color:var(--cyan);border:1px solid var(--rule)}
.proof{border:1px solid var(--rule);background:rgb(17 28 38 / .9);border-radius:.375rem;padding:1.25rem}.proof strong{display:block;color:var(--amber);font:700 clamp(2rem,5vw,4rem)/1 ui-monospace,monospace}.proof span{color:var(--muted)}
.section{border-top:1px solid var(--rule);padding:clamp(2.5rem,6vw,5rem) 0}.section h2{max-width:16ch;margin:0;font:600 clamp(2rem,4vw,3.5rem)/1 Georgia,serif}.section p{color:var(--muted);max-width:55rem}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-top:1.5rem}.card{border:1px solid var(--rule);background:var(--surface);padding:1rem;border-radius:.375rem}.card h3{margin-top:0}.card p{margin-bottom:0}.ui-preview{border:1px solid var(--rule);background:var(--surface);padding:1rem;border-radius:.375rem;margin-top:1.5rem;overflow:auto}.ui-preview table{width:100%;border-collapse:collapse;min-width:38rem}.ui-preview th,.ui-preview td{padding:.75rem;border-top:1px solid var(--rule);text-align:left}.risk{color:var(--amber);font-weight:700}.footer-cta{background:var(--raised);padding:clamp(1.5rem,4vw,3rem);border-radius:.375rem}
@media (max-width:760px){.hero{grid-template-columns:1fr;padding-top:4rem}.cards{grid-template-columns:1fr}.masthead{align-items:flex-start}.nav{justify-content:flex-end}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

export function renderLandingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="Risk-bounded FinOps commitment optimization with deterministic replays, frozen price tables, and CFO-ready recommendations.">
<meta name="keywords" content="FinOps commitment optimization, reserved instance portfolio, savings plan risk">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>${escapeHtml(PRODUCT_NAME)} | Buy commitments like a portfolio</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="masthead">
<div class="brand">${PRODUCT_NAME}</div>
<nav class="nav" aria-label="Primary navigation"><a href="#replay-proof">How it works</a><a href="#self-host">Self-host</a><a class="button" href="/login" data-conversion-event="landing_cta_clicked">Sign in</a></nav>
</header>
<main id="content">
<section class="hero" aria-labelledby="hero-title">
<div><p class="eyebrow">FinOps commitment control room</p><h1 id="hero-title">Buy cloud commitments like a portfolio, not a spreadsheet guess.</h1><p class="lede">Model demand uncertainty, compare commitment instruments, and put a frozen, risk-bounded recommendation in front of the right approver.</p><div class="actions"><a class="button" href="#replay-proof" data-conversion-event="demo_replay_started">Run a 12-month replay</a><a class="button secondary" href="/login" data-conversion-event="landing_cta_clicked">Open the underwriting desk</a></div></div>
<aside class="proof" aria-label="Product promise"><strong>12 mo</strong><span>deterministic replay window with actual usage held out at each decision date</span></aside>
</section>
<section class="section" aria-labelledby="pain-title"><h2 id="pain-title">The hard part is downside, not another savings estimate.</h2><p>Commitments become expensive when seasonality, migrations, stale prices, or account concentration are flattened into one average. The optimizer keeps expected savings beside p95 downside, utilization, confidence, and the binding constraint.</p><div class="cards"><article class="card"><h3>Replay the decision</h3><p>See what a policy would have known at each month instead of leaking future usage into the past.</p></article><article class="card"><h3>Freeze the evidence</h3><p>Every recommendation carries the exact forecast, price version, policy, and scenario that produced it.</p></article><article class="card"><h3>Keep control human</h3><p>High-value recommendations can wait in a tenant-scoped approval queue before any execution decision.</p></article></div></section>
<section class="section" id="replay-proof" aria-labelledby="proof-title"><h2 id="proof-title">Replay proof before purchase pressure.</h2><p>Start with synthetic or provider billing exports, run the forecast and optimizer, then inspect the efficient frontier and baseline comparison. No ecosystem service is required for the core flow.</p><div class="ui-preview"><table><caption>Illustrative recommendation review</caption><thead><tr><th scope="col">Portfolio choice</th><th scope="col">Expected saving</th><th scope="col">p95 downside</th><th scope="col">Risk</th></tr></thead><tbody><tr><td>AWS Compute Savings Plan · 12 months</td><td>Paired with frozen price version</td><td>Paired with risk budget</td><td class="risk">Review constraints</td></tr></tbody></table></div></section>
<section class="section" aria-labelledby="method-title"><h2 id="method-title">A method built for finance review.</h2><div class="cards"><article class="card"><h3>Provider-aware instruments</h3><p>AWS Compute Savings Plans and Reserved Instances, Azure Savings Plans and Reservations, and GCP CUD paths stay explicit; unsupported combinations are blocked with a reason.</p></article><article class="card"><h3>Optional integrations</h3><p>Local notifications and the approval queue work with adapters disabled. Notification Hub and Workflow Engine are opt-in and recorded through an idempotent event ledger.</p></article><article class="card"><h3>Privacy by boundary</h3><p>Uploads are tenant-scoped billing evidence. Credentials are never uploaded, raw billing rows stay out of rendered pages, and support sharing is a deliberate choice.</p></article></div></section>
<section class="section" id="self-host" aria-labelledby="host-title"><h2 id="host-title">Self-host the decision trail.</h2><p>Run the API, worker, PostgreSQL, Redis, and local object storage with the production Compose topology. Setup, migration, backup, and restore commands are documented for an operator-controlled environment.</p><div class="actions"><a class="button" href="/login" data-conversion-event="self_host_docs_opened">Start with a local tenant</a><span class="lede">No live cloud credentials or paid service is needed for the fixture-backed flow.</span></div></section>
<section class="section footer-cta" aria-labelledby="cta-title"><h2 id="cta-title">Make the next commitment decision explainable.</h2><p>Bring the replay, risk budget, and approval snapshot into the room together.</p><a class="button" href="/login" data-conversion-event="landing_cta_clicked">Run a 12-month replay</a></section>
</main>
</body>
</html>`;
}
