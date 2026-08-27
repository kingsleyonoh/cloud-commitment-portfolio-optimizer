# Cloud Commitment Portfolio Optimizer — Visual and Interaction System

**Status:** Phase 0 design baseline
**Product contract:** `PRODUCT.md`
**Canonical source:** `docs/cloud-commitment-portfolio-optimizer_prd.md`

This is an implementation contract for future Fastify/HTMX/Tailwind screens. It defines what to build and how future evidence will be measured; it does not claim that a reachable UI or its audit artifacts exist today.

## Aesthetic Thesis

### Calibrated Underwriting Desk

The interface should feel like a serious underwriting workstation translated into a modern browser: graphite instruments, ledger-like alignment, restrained paper warmth, precise cyan for selection, and amber for material uncertainty. Its dominant tone is **industrial / utilitarian**, tempered by an **editorial** reading hierarchy for CFO-facing decisions.

The emotional sequence is: **control in three seconds → evidence in thirty seconds → provenance on demand**. Density is welcome when structure is explicit. Decoration is not.

### Differentiation anchor: the Risk Rail

Every recommendation detail carries a vertical **Risk Rail**: a narrow, persistent sequence of no-action baseline → expected net saving → p95 downside → confidence → binding constraint → frozen-input seal. Values line up on a shared numeric axis and use labels plus line/marker shapes. The rail makes a screenshot recognizable without a logo and prevents a saving figure from escaping its risk context.

> This avoids generic UI by organizing the product around a decision-grade Risk Rail and ledger evidence hierarchy instead of a KPI-card grid, floating assistant, or decorative gradient dashboard.

Conceptual references are trading blotters, credit-underwriting memos, engineering control panels, and printed financial schedules—not a direct visual copy of any product.

## Design Feasibility and Impact Index

| Dimension | Score (1–5) | Rationale |
|---|---:|---|
| Aesthetic impact | 4 | The Risk Rail, ledger rules, and paper/graphite contrast create a recognizable identity. |
| Context fit | 5 | Underwriting and control-room cues match high-stakes FinOps decisions. |
| Implementation feasibility | 5 | CSS tokens, server HTML, SVG, and HTMX can deliver it without a client framework. |
| Performance safety | 5 | Sparse motion, no texture assets, and subset fonts keep the direction lean. |
| Consistency risk | 4 | Dense screens require disciplined primitives and review to avoid visual noise. |

**DFII = (4 + 5 + 5 + 5) − 4 = 15 (excellent).** Execute fully, while treating density consistency as the primary review risk.

## Typography

Typography separates executive interpretation from operational evidence.

- **Display / decision voice — Newsreader:** a self-hosted variable subset for page titles, decision statements, and large financial outcomes. Its editorial authority makes recommendation reports feel authored rather than assembled. Never use it below 18px or for dense tables.
- **Body / interface voice — IBM Plex Sans:** a self-hosted subset for navigation, controls, explanations, tables, and form labels. Its engineered character fits a control room while remaining readable under density.
- **Numeric supplement — IBM Plex Mono:** tabular amounts, percentages, timestamps, checksums, versions, and run identifiers only. This is a functional supplement, not a third expressive voice.
- Prefer `font-variant-numeric: tabular-nums lining-nums` for comparable economics.
- Use sentence case for headings and controls. Uppercase is limited to 11–12px ledger labels with tracking; never use all-caps paragraphs.
- Amounts never rely on font weight alone to convey good/bad. Currency, sign, timeframe, and basis are explicit.

```css
:root {
  --font-display: "Newsreader", Georgia, serif;
  --font-body: "IBM Plex Sans", "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", "Cascadia Mono", monospace;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-md: 1rem;
  --text-lg: 1.25rem;
  --text-xl: clamp(1.75rem, 3vw, 2.75rem);
  --leading-tight: 1.15;
  --leading-body: 1.5;
}
```

Font files must be locally hosted, WOFF2, subset to used weights/characters, and preloaded only for above-the-fold faces. The UI remains legible under fallback fonts without metric-breaking clipping.

## Color and Tokens

The palette is dominated by near-black navy and mineral paper. Cyan indicates current selection/information; amber indicates uncertainty or attention. Success is a muted mineral teal, never a celebratory neon green. Critical downside uses iron red. Risk meaning always includes text/icon/shape.

```css
:root {
  --color-ink-950: #0a1118;
  --color-ink-900: #111c26;
  --color-ink-800: #1a2a36;
  --color-paper-50: #f4f1e8;
  --color-paper-100: #e9e4d8;
  --color-paper-300: #c8c0af;
  --color-slate-500: #687782;
  --color-slate-700: #344550;
  --color-cyan-400: #42c6d7;
  --color-cyan-700: #137e8e;
  --color-amber-400: #e7ad45;
  --color-amber-800: #7b4d0e;
  --color-teal-500: #3d9b83;
  --color-teal-800: #195c4b;
  --color-red-500: #d06a62;
  --color-red-800: #782d2a;

  --color-canvas: var(--color-ink-950);
  --color-surface: var(--color-ink-900);
  --color-surface-raised: var(--color-ink-800);
  --color-text: var(--color-paper-50);
  --color-text-muted: #aeb8bd;
  --color-rule: #31414c;
  --color-focus: var(--color-cyan-400);
  --color-warning: var(--color-amber-400);
  --color-danger: var(--color-red-500);
  --color-success: var(--color-teal-500);

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4rem;

  --radius-control: 0.25rem;
  --radius-panel: 0.375rem;
  --border-hairline: 1px;
  --shadow-raised: 0 12px 36px rgb(0 0 0 / 0.24);
  --focus-ring: 0 0 0 3px rgb(66 198 215 / 0.45);
  --duration-fast: 120ms;
  --duration-base: 180ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}
```

### Token rules

- Application UI is dark-dominant; printable/exported reports invert to mineral paper with ink text.
- Use surface steps and rules before shadows. Shadows mean temporary elevation (dialog/drawer/popover), not “card importance.”
- Never hard-code colors, spacing, radii, shadows, or durations in templates when a semantic token exists.
- Body text must meet 4.5:1 contrast; large text and meaningful graphics must meet 3:1.
- Warning/danger/success tokens are reserved for state, not branding or decoration.

## Layout and Density

The shell uses a 12-column desktop grid, but analytical screens deliberately break symmetry: 7 columns for evidence, 3 for the Risk Rail, and 2 for provenance/actions. This 7/3/2 rhythm is the signature composition.

- Maximum readable content width: 1600px; dense tables may span the shell, while narrative report copy caps at 76 characters.
- A 4px base spacing rhythm supports density; major section changes use 24–48px rather than stacking detached cards.
- Use ruled sections, inset bands, and aligned columns. Avoid a box around every concept.
- One dominant page statement; one primary action per workflow stage. Secondary controls sit in a compact command strip.
- Sticky elements are limited to table headers, current tenant/context bar, and the recommendation decision bar. Their stacked height must remain below 25% of the viewport.
- Density modes are not user-selectable in MVP. Use the defined compact row (40px desktop) and comfortable row (48px mobile/touch) consistently.
- Empty space around the decision statement contrasts with dense evidence below; do not distribute all regions evenly.

### Application frame

1. **Context masthead:** product mark, tenant, environment, global status, user/role.
2. **Task navigation:** Import → Forecast → Optimize → Decide → Replay, with Settings/Audit subordinate.
3. **Page ledger:** title, frozen scope/version, state, and primary action.
4. **Evidence canvas:** tables/charts/forms.
5. **Provenance footer/aside:** run IDs, versions, actor, timestamps, snapshot/export.

## Data Visualization

Charts exist to compare uncertainty and constraints, not to decorate metrics.

### Efficient frontier

- X-axis: downside/risk measure; Y-axis: expected net saving. Units and reporting currency are written out.
- No-action and configured baselines use heavy neutral rules; feasible portfolios use cyan marks; selected portfolio uses a cyan ring plus direct label; infeasible/excluded candidates use hollow marks.
- The risk-budget boundary is an amber ruled region. Binding candidates get direct annotations, not hover-only tooltips.
- Tooltip content mirrors a keyboard-focusable data point and never contains the only copy of a value.

### Forecast and replay

- Forecast shows p10–p90 band, p50 line, actual/history, scenario shock, and confidence note. Do not smooth away missingness.
- Replay charts name baseline and show cumulative net saving, downside events, unused waste, and regret. Positive savings cannot share a single ambiguous axis with loss without distinct labels.
- Charts always provide a text summary and semantic data table/CSV alternative in the same region.
- Avoid pie/donut charts, 3D charts, rainbow category palettes, unexplained dual axes, and red/green-only encoding.
- Server-render an accessible summary and table first. Dynamically import heavy chart enhancement only when the chart region is present.

## Tables

Tables are the primary analytical instrument.

- Use native `<table>`, `<caption>`, `<thead>`, `<tbody>`, scoped `<th>`, and explicit sortable-button labels.
- Left-align labels; right-align numeric values on tabular figures; align decimals when comparisons are central.
- Sticky headers require opaque backgrounds and visible focus. The first identity column may be sticky on controlled horizontal scroll.
- Row hover is supplemental. Keyboard focus and selected state use a left cyan rule plus background shift.
- Status cells include plain text and an icon/shape; savings cells pair downside/confidence in adjacent columns or the Risk Rail.
- Pagination is server-owned. Show row range and total when known; never silently truncate.
- Loading preserves header/column geometry. Empty is one full-width explanatory row. Error is a captioned region above the table, not a fake row of data.
- On mobile, approval/audit tables can become labeled definition rows. Comparative planning tables retain semantic table markup in a horizontally scrollable region with a cue and sticky first column.
- Bulk selection must show count, scope, and action consequence; destructive or financial actions require review, not a hidden kebab command.

## Forms

- Labels are persistent and precede controls. Placeholder text is example/help only.
- Group policy fields by economic consequence: saving floor, downside budget, utilization, liquidity, allowed instruments, approval threshold.
- Inputs show unit inside a stable suffix/prefix (`USD`, `%`, `months`) without becoming part of the editable value.
- Help text states consequence, not implementation detail: “Portfolios above this p95 loss are infeasible.”
- Validate on submit and after meaningful blur; do not punish partial numeric entry. Preserve valid values after errors.
- Error summary receives focus, links to invalid fields, and each field uses `aria-invalid` plus `aria-describedby`.
- File upload previews provider/source, account scope, period, format, size, identifier privacy warning, and support-sharing boundary before submission.
- Adapter enablement lists outbound event categories, endpoint host (without credentials), canonical local behavior, and an explicit confirmation control.
- Approval requires a decision reason. Reject and approve are separated spatially and verbally; approve is not visually dominant until evidence has been reviewed.
- Disabled controls explain why nearby; permissions remove mutation controls entirely when the role cannot act.

## HTMX Interaction Patterns

Server-rendered HTML is the source of truth. HTMX enhances local transitions; it must not create a second client-side state model.

- Every enhanced action has a normal HTTP fallback and a stable route.
- Use the smallest owning region as `hx-target`; never replace the entire shell for a field or row action.
- Use `hx-swap="outerHTML"` for complete state regions and `beforeend` only for append-only activity/audit feeds with deduplication.
- Mutations return the updated canonical fragment plus out-of-band status/audit updates when needed.
- Submit buttons become `aria-disabled`/disabled while requests are in flight; an in-region loading label names the action. Idempotency is server-enforced.
- On success, focus moves to the updated heading/status when context changed; otherwise preserve logical focus. On error, focus moves to the error summary.
- Confirm consequential actions in an accessible `<dialog>` or dedicated review step with action, amount, scope, and effect—not a browser confirm string.
- URL/history changes are reserved for navigable filters, tabs, and resources. Temporary drawers and validation states do not pollute history.
- `HX-Trigger` events may announce state changes or refresh dependent fragments, but payloads contain identifiers/status only—never credentials or raw billing rows.
- Timeouts/network failures render the `network unavailable` contract. The browser does not store or later replay optimizer/approval mutations.

## Responsive Behavior

The composition responds at product-defined targets, not arbitrary device labels.

### 1440px desktop

- Use 7/3/2 evidence/Risk Rail/provenance composition where the screen supports a decision.
- Persistent task navigation and filter rail are allowed.
- Dense table rows target 40px; hover may supplement focus.
- Frontier and scenario evidence can appear side by side when each retains readable axes.

### 1024px tablet

- Collapse global navigation and filters into labeled drawers.
- Keep evidence and Risk Rail visible as 8/4 columns; provenance moves below.
- Show one primary chart at a time with a tabbed, keyboard-operable switch and controlled horizontal exploration.
- Do not hide column meaning; prioritize action, net saving, p95 downside, confidence, state.

### 390px mobile

- Use one column and 48px action rows; every actionable touch target is at least 44px in both dimensions.
- Recommendation/approval order: decision statement → paired economics → Risk Rail → constraints → input seal → reason → reject/approve.
- Decision actions sit in normal flow or a safe sticky footer that respects keyboard/safe-area and never covers content.
- Dashboard shows triage queues and risk exceptions, not miniature charts or a compressed desktop KPI grid.
- Bulk import, price authoring, and frontier editing show status plus desktop guidance. Mobile must still expose errors, provenance, and read-only records.
- No horizontal page overflow at 320–390px. Only explicitly labeled table/chart scrollers may overflow their region.

## Accessibility

- Meet WCAG 2.1 AA across keyboard, screen reader, zoom/reflow, contrast, target size, status, and error handling.
- Use a skip link, semantic landmarks, one `<h1>`, hierarchical headings, and unique page titles that include tenant-neutral resource context.
- Focus ring uses `--focus-ring`, remains visible on every surface, and is never removed without an equivalent.
- All functionality works with Tab, Shift+Tab, Enter/Space, Escape, and arrow keys only where the ARIA pattern requires them.
- Native controls and native tables are preferred. ARIA augments semantics; it does not rebuild standard elements.
- Status announcements use `role="status"` for polite completion and `role="alert"` for blocking errors. Avoid repeated live-region chatter during polling.
- Charts expose a summary and data table; visual marks have keyboard focus only when they perform or reveal a meaningful action.
- Risk, confidence, import status, and adapter state never rely on color alone.
- Text resize to 200% preserves content and operation; at 400% zoom / 320 CSS px reflow, decision content and actions remain available without two-dimensional page scrolling.
- `prefers-reduced-motion: reduce` disables interpolation and nonessential transitions. `prefers-contrast` may strengthen rules/focus without changing meaning.

## Loading, Empty, and Error States

State design follows the PRODUCT contract and maintains hierarchy.

| State | Visual treatment | Interaction rule |
|---|---|---|
| loading | Preserve exact region geometry; use a low-contrast ruled placeholder and verb (“Running optimizer…”) | Prevent duplicate mutation; keep cancel/navigation if safe; do not use an indefinite spinner alone. |
| empty | Open paper-toned inset with one explanation and one role-valid first action | Distinguish “no records” from filtered zero results; include clear-filter action when relevant. |
| import quarantined | Amber left rule, source retained, issue categories and control-total delta | Link to mapping/remediation; never offer optimizer run on quarantined data. |
| forecast low confidence | Amber uncertainty band and explicit quality summary | Keep run accessible; show downstream conservative effect and scenario action. |
| optimizer infeasible | Risk Rail ends at constraint stop; no “failed” celebration/toast | List binding constraints and ranked relaxations; any policy edit starts a new run. |
| recommendation blocked | Iron-red stop marker with missing/stale prerequisite | Link authorized users to source fix; never show estimated saving fallback. |
| approval expired | Desaturated decision bar and timestamped expiry seal | Remove decision actions; offer new request only where state policy permits. |
| adapter disabled | Neutral disconnected glyph and “optional” label | Core actions remain active; configuration visible only to admins. |
| adapter retrying | Local success remains teal; external mirror gets amber retry detail | Show safe last-attempt time/reference, not raw remote body. |
| permission denied | Plain denied panel with role context and safe return route | Do not render hidden resource details or mutation controls. |
| network unavailable | Connection rule breaks across region; entered safe fields remain | Retry explicitly; never queue consequential mutations in browser storage. |
| success | Restrained teal rule/check plus result noun/reference | Announce once; keep durable status in content instead of relying on a toast. |

Skeleton shimmer is avoided because it implies decorative motion and uncertain shape. Polling regions show last updated time, current stage, and an accessible manual refresh fallback.

## Motion

Motion explains state continuity; it is sparse and CSS-first.

- One page entrance: 180ms fade/translate (maximum 8px) for the evidence canvas after server navigation. The masthead and decision actions do not drift.
- HTMX region updates use a 120ms opacity transition only when it helps identify the changed region.
- The selected frontier point may transition along the curve only when the underlying scenario changes and the animation duration is at most 240ms.
- Loading indicators are static ruled progress for unknown duration or width progress for known stages; avoid endless rotation.
- No parallax, bouncing numbers, confetti, pulsing risk badges, ambient gradients, or staggered card choreography.
- Under reduced motion, all transforms/interpolation are removed and opacity changes are effectively immediate (`<= 1ms`). Focus, status, and content remain identical.

## Trust, Audit, and Provenance

Trust is a first-class visual layer, not an “advanced” drawer that hides the decision source.

### Frozen-input seal

Every recommendation/report/approval displays a compact seal containing:

- snapshot/frozen status;
- billing import checksum/reference and period;
- price-table version labels/effective dates;
- forecast run/method/quality;
- scenario and optimizer-policy versions;
- deterministic seed or replay reference where safe;
- generated/approved actor and timestamp;
- superseded/expired status when applicable.

The seal starts compact but its primary version/freshness labels remain visible. Expansion is semantic disclosure, printable, and keyboard operable. Checksums and IDs use the numeric/mono face and offer explicit copy buttons; no automatic clipboard write.

### Risk Rail rules

- Baseline, expected net saving, p95 downside, confidence, binding constraints, and input seal appear in that order.
- Currency and period are repeated where ambiguity is possible.
- Positive expected saving never changes the downside marker into a success state.
- Frozen and live values are never mixed. A newer source creates a clear “newer data available” callout and a new-run action, not an in-place update.

### Audit surfaces

- Audit rows lead with action + resource + actor + time, then safe metadata.
- Exports include tenant identity, filter scope, generated time, and snapshot references but exclude secrets/internal solver details.
- Optional adapter status separates local canonical outcome from remote attempt status.
- Errors show a correlation reference suitable for support without exposing stack traces, credentials, or remote bodies.

## Anti-Generic Constraints

These are review failures, not preferences.

- No purple gradient branding, glass panels, neon glows, aurora backgrounds, or blurred floating orbs.
- No dashboard made primarily of equal-sized KPI cards. Use a decision statement, exceptions queue, ruled tables, Risk Rail, and provenance.
- No generic “Welcome back” hero, random illustration, emoji state icon, fake activity, or motivational copy.
- No savings badge without downside, confidence, baseline, and timeframe nearby.
- No rounded container around every paragraph. Panels use small radii; structure comes from alignment, rules, and surface bands.
- No icon-only consequential actions, hidden kebab menu for primary tasks, hover-only evidence, or color-only risk.
- No invented AI assistant, fabricated recommendation explanation, or chat surface detached from frozen evidence.
- No client-rendered SPA state model where HTMX/server state is sufficient.
- No chart library in the dashboard’s first-load bundle merely to render a sparkline.
- No animation that delays reading, moves financial values decoratively, or ignores reduced motion.
- No placeholder labels such as “Data,” “Insights,” or “Overview” when the domain term is Import health, Forecast quality, Downside budget, Approval queue, or Replay regret.

## Evidence Plan

**Evidence status: planned — not yet produced.** This baseline defines future gates and artifact names. A gate label below is a target output only; it must not be marked complete until the relevant routes exist and the cited artifacts are captured from a deterministic local run.

### Numeric acceptance thresholds

| Measure | Threshold |
|---|---:|
| Desktop viewport | 1440px |
| Tablet viewport | 1024px |
| Mobile viewport | 390px |
| Narrow reflow viewport | 320px |
| Touch target minimum | >= 44px |
| Text resize | 200% |
| Narrow reflow | 320 CSS px at 400% zoom |
| Dashboard JavaScript | < 180 KB gzip |
| Dashboard LCP | < 2.5s |
| Unexpected horizontal page overflow | 0px |
| Unredacted sensitive identifiers | 0 |
| Console errors | 0 |
| Failed same-origin requests | 0 |
| Critical or serious accessibility violations | 0 |
| Keyboard-blocked critical actions | 0 |
| P0/P1 frontend-polish findings | 0 |
| Body text contrast | >= 4.5:1 |
| Large text / meaningful graphic contrast | >= 3:1 |

### Desktop/mobile visual QA — target `MOBILE_VIEWPORT_PASS`

When dashboard and approval routes exist:

1. Seed one deterministic tenant fixture with normal, low-confidence, blocked, infeasible, expired, and disabled/retrying adapter states. Use synthetic identifiers only.
2. Capture full-page and Risk Rail screenshots at exactly 1440px, 1024px, 390px, and 320px in isolated Playwright contexts.
3. Exercise dashboard triage and complete approval review → reject, then reset fixture and review → approve at 390px with touch emulation.
4. Assert no unexpected page overflow, no covered controls, touch targets at least 44px, and preserved order of economics/constraints/provenance/actions.
5. Capture screenshots, Playwright trace for the mobile approval flow, and assertion output under `.pi/browser/` or the owning Mesh mission.
6. Review desktop density, tablet drawers, mobile reading order, table scrollers, text zoom, and visual-diff output. A screenshot alone is not a pass.

### Privacy/redaction QA — target `PRIVACY_MATRIX_PASS`

Build a route × data-class × sink matrix covering billing upload, import detail, recommendation/report, approval, audit, integration setup, support-share preview, analytics, browser storage, clipboard, downloads, screenshots, logs, and HTMX payloads.

- Seed canary values for account ID, tag/project name, cost center, email, API-key-shaped value, and raw billing description.
- Verify default account masking, explicit reveal behavior, support-share redaction preview, adapter consent copy, no sensitive browser/CDN caching, and analytics disabled/redacted defaults.
- Scan rendered DOM, captured screenshots/traces, console output, request URLs/bodies/headers after sanitizing authorization metadata, storage summaries, and generated exports for canaries.
- Required result: **Unredacted sensitive identifiers | 0** outside the explicitly authorized reveal/export fixture; record every allowed location and rationale in the matrix.
- Never save credentials, cookies, signed URLs, or real provider exports as evidence.

### Console/network QA

For each critical journey—first import, forecast/optimizer run status, recommendation review, mobile approval, report export, adapter-disabled core flow:

- start a clean browser context and capture console, failed requests, HTTP 4xx/5xx, and relevant sanitized fetch/XHR summaries;
- distinguish expected tested 4xx validation cases from unexpected network failures in the artifact;
- require **Console errors | 0** and **Failed same-origin requests | 0** for the happy path;
- retain screenshots plus console/network summaries and a Playwright trace for any failure repro.

### Bundle/performance QA — target `BUNDLE_DYNAMIC_IMPORT_AUDIT_PASS`

- Build production assets and save a route-to-chunk manifest with raw and gzip bytes.
- Navigate dashboard, forecast, optimizer frontier, and Parquet import preview separately in clean contexts.
- Assert dashboard initial JavaScript is **< 180 KB gzip** and contains no heavy charting or Parquet preview module.
- Assert chart code loads only on forecast/frontier routes and Parquet preview code only after its import-screen trigger.
- Capture coverage/resource waterfall and verify no duplicate charting packages or font formats.
- Measure dashboard LCP on the PRD target dataset and representative throttled profile; require **Dashboard LCP | < 2.5s**. Report median plus worst of at least three deterministic runs rather than cherry-picking.
- Track font WOFF2 bytes and avoid preloading faces not used above the fold.

### Accessibility QA

- Run automated WCAG checks on all critical routes/states at desktop and mobile; require **Critical or serious accessibility violations | 0**.
- Manually complete navigation, filtering, upload validation, chart/table switch, recommendation reading, approve/reject dialog, and error recovery by keyboard only; require **Keyboard-blocked critical actions | 0**.
- Inspect heading/landmark order, names/labels, focus movement after HTMX swaps, error summary links, status announcements, table semantics, chart data alternatives, text resize to 200%, 400% zoom / 320 CSS px reflow, contrast, and reduced motion.
- Save machine-readable audit output, keyboard checklist, and screenshots of focus/error/reflow states. Automated output alone is insufficient.

### Frontend-polish review — targets `FRONTEND_IMPECCABLE_AUDIT_PASS` and `FRONTEND_IMPECCABLE_POLISH_PASS`

Review every changed route against PRODUCT.md, this system, and the frontend-design direction in two passes:

1. **Audit pass:** accessibility, performance, theming/token use, responsive behavior, privacy boundary, bundle ownership, complete interaction states, and anti-generic constraints.
2. **Polish pass:** 4px rhythm, 7/3/2 hierarchy, typography roles, decimal alignment, contrast, focus/hover/active/disabled states, copy specificity, Risk Rail consistency, motion/reduced motion, and provenance integrity.

Record findings by route/component, severity P0–P3, screenshot/DOM/source pointer, and disposition. Require **P0/P1 frontend-polish findings | 0** before claiming either gate. P2/P3 must be fixed or entered as explicit follow-up evidence; they are never erased by a generic “looks good.” If a compatible local detector is used, pin/record its version and save JSON output rather than relying on an unrecorded latest-version run.

### Evidence ownership and anti-claim rule

- Each gate record names command, timestamp, fixture/seed, route, viewport, browser/runtime version, artifact path, thresholds, actuals, and reviewer.
- Evidence artifacts must use synthetic tenant/provider data and sanitized request metadata.
- A future progress item may reference a gate only after its artifacts exist and the measured values satisfy this table.
- Until then, use “planned,” “target,” or “not yet evidenced”; do not use pass/completed language for these gates.

## PRD Traceability

| Design decision | Canonical source |
|---|---|
| FinOps command-center tone, dense legible tables, muted risk, frontier clarity | PRD §5b Frontend Product Quality Contract |
| 1440px / 1024px / 390px responsive targets and 44px touch target | PRD §5b Responsive Behavior / quality contract |
| WCAG 2.1 AA, keyboard, focus, semantic tables, chart alternatives, reduced motion | PRD §5b Accessibility |
| Complete named state hierarchy and network-disabled behavior | PRD §5b state/offline contract |
| Billing identifier warning, support-share redaction, explicit adapter enablement | PRD §5b privacy/consent contract |
| Dashboard JS under 180KB gzip; chart/Parquet dynamic ownership | PRD §5b bundle/performance contract |
| Dashboard LCP under 2.5s | PRD §10b Performance Targets |
| Immutable economics and role-specific mutation | PRD §8 Admin/UI |
| No live purchase, generic dashboard clone, direct delivery, or unsafe invoice path | PRD §12 What NOT to Build |
| Mobile, accessibility, privacy, bundle, and polish acceptance | PRD §15 Success Criteria |
