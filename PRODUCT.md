# Cloud Commitment Portfolio Optimizer — Product UX Contract

**Status:** Phase 0 baseline
**Canonical source:** `docs/cloud-commitment-portfolio-optimizer_prd.md`
**Applies to:** server-rendered Fastify + HTMX product surfaces, reports, and approval flows

This document turns the PRD into an interface contract. It does not expand scope or claim that the screens or quality evidence already exist. When this document and the PRD differ, the PRD wins.

## Product Promise

Cloud Commitment Portfolio Optimizer helps a finance and technology team decide whether to buy, renew, resize, sell or exchange where supported, manually review, or take no action on cloud commitments under uncertain demand. It replaces the false precision of a spreadsheet savings percentage with a frozen, reviewable decision packet: expected net savings, downside exposure, utilization uncertainty, liquidity cost, confidence, baseline comparison, and binding constraints.

The product should feel like an underwriting desk for cloud commitments—not a generic cloud-cost dashboard. Its primary promise is **“Buy cloud commitments like a portfolio, not a spreadsheet guess.”** The product is advisory in MVP: a human remains responsible for any provider-side action. (PRD §1, PRD §2, PRD §12)

## Audiences and Jobs

### CFO / Finance Approver

- **Job:** decide whether the forecasted saving justifies downside risk and cash lock-in.
- **Needs before acting:** amount and term, expected net savings, p95 downside loss, upfront exposure, utilization range, confidence, the baseline beaten, binding constraints, price-table age, and a frozen approval snapshot.
- **UX priority:** an approval packet readable in minutes, with reject and approve actions distinct, reason required, and no mutable economics hidden behind drill-downs.
- **Failure to avoid:** a positive green badge that omits unused-commitment waste or downside.

### CTO / Technology Executive

- **Job:** test whether the recommendation survives migration, seasonality, growth, and demand-drop scenarios.
- **Needs before acting:** efficient frontier, scenario deltas, concentration warnings, forecast quality, replay results, and explicit infeasibility reasons.
- **UX priority:** fast movement between executive summary and technical provenance without changing the frozen decision.

### Head of FinOps / FinOps Analyst

- **Job:** import billing and price data, inspect quality, model scenarios, run the optimizer, compare against prior periods, and request approval.
- **Needs before acting:** import control totals and quarantine reasons, price version/staleness, forecast p10/p50/p90, policy constraints, run status, and actionable remediation.
- **UX priority:** dense, keyboard-efficient desktop workflows with honest status and no silent fallback pricing.

### Analyst Automation / API Key

- **Job:** run the repeatable tenant-profile, cloud-account setup, import, forecast, optimizer, recommendation/report-read, and future analyst request/backtest workflows from scripts or service clients.
- **Authority:** every accepted-schema API key is a fixed deny-by-default `finops_analyst` actor with no user identity. It may read/create/update cloud accounts but not deactivate them; price tables are read-only; all user/key administration, policy/settings/integration management, audit access, approval queues/decisions, price-table mutation, and unenumerated actions are denied.
- **UX priority:** one-time plaintext issuance, clear `X-API-Key` guidance, generic failures, and no copy or control suggesting the key can become an admin JWT.

### Tenant Admin

- **Job:** as a JWT-authenticated `tenant_admin` user, manage tenant identity, users, API-key metadata/rotation, cloud accounts, risk policy, and optional adapters while preserving a standalone core.
- **Needs before acting:** permission boundaries, adapter dependency status, privacy consequences, audit events, and safe defaults.
- **UX priority:** explicit enablement and fail-safe configuration; disabled adapters must not appear as broken core functionality.

### Read-only Auditor

- **Job:** establish who decided what, from which frozen inputs, and whether a later render still matches that decision.
- **Needs before acting:** immutable snapshots, actor and timestamp, input checksums/version labels, decision reason, policy, and replay identifiers.
- **UX priority:** provenance is visible and exportable; mutation controls are absent rather than merely disabled.

These roles and actions derive from the Roles × Resource Actions matrix and Admin/UI permissions. (PRD §2b, PRD §8)

## Decision Workflow

The interface follows a deliberate evidence funnel. Each step must show its prerequisites and must never imply that a later step is valid when an earlier one is blocked.

1. **Establish tenant context.** Resolve the tenant and role before showing any data-bearing surface. The current tenant is always visible in the application frame.
2. **Import evidence.** Upload a billing export, show file/source/period/account scope, validate control totals, and quarantine invalid or materially unmapped data rather than partially presenting it as ready.
3. **Version prices.** Identify provider, instrument, effective period, checksum/version label, and freshness. A stale or missing table blocks affected candidates; it never triggers fallback economics.
4. **Forecast uncertainty.** Show p10/p50/p90 or equivalent distribution, holdout quality, residual drift, warnings, and scenario assumptions. Low confidence travels forward visibly.
5. **Set policy and scenario.** Show downside budget, minimum expected saving, utilization tolerance, liquidity penalty, allow-list, approval threshold, and seed/input freeze point.
6. **Run optimizer.** A queued/running state preserves the frozen inputs. Completion yields an efficient frontier, no-action baseline, feasible recommendations, or a precise infeasibility explanation.
7. **Review recommendation.** Present action, amount, term, expected net saving, p95 downside loss, confidence, utilization, price version, forecast quality, baseline delta, and binding constraints together.
8. **Request and make approval.** Freeze the decision packet. Approve or reject with an attributable reason; expiry and supersession are explicit states.
9. **Export or act manually.** Render HTML/PDF/JSON from the frozen snapshot. Any provider-side execution remains outside the product boundary.
10. **Replay.** Re-run from frozen inputs and deterministic seed, or backtest historical decision months without future leakage; compare regret and downside to named baselines.

The first-run, monthly planning, finance approval, replay, and integration flows map directly to PRD §5b. The workflow implements **Risk-bounded savings over headline savings** and **Replayable economics** from PRD §2.

## Explain Before Automate

**Explain before automate** is both a product principle and a release gate. No recommendation action is complete unless the same decision surface answers:

- What is being suggested, for which provider/instrument/term and amount?
- What no-action or configured baseline did it beat, and by how much net of waste and liquidity cost?
- What is the p95 downside loss and policy limit?
- Which constraints bind, which candidates were excluded, and why?
- What forecast distribution and quality warning shaped the result?
- Which price-table versions and effective dates were frozen?
- What confidence or risk band applies, beyond color?
- What changes under the selected scenario?
- Does the decision need approval, and who can decide?
- Can the result be replayed from the displayed snapshot/seed identifiers?

Savings must never stand alone. A saving figure is paired with downside and confidence in cards, tables, charts, reports, notifications, and exports. An infeasible result is a valid decision outcome: show ranked relaxation suggestions, but never silently relax policy. An external Workflow Engine trigger can request human review; it cannot erase the explanation or approval boundary. (PRD §2, PRD §5.5, PRD §5.7)

## Tenant, Audit, and Replay Boundaries

### Tenant boundary

- **Tenant-scoped by default:** every data-bearing view, filter, mutation, download, notification, job status, and report is resolved under one tenant.
- Tenant metadata, login users, and API-key records are separate persistence boundaries: tenant profiles never embed user rows, key rows, stored hashes, or plaintext credentials. A generated API key is visible only in the successful one-time setup, registration, or targeted-rotation response.
- Public tenant registration is a fail-safe operational surface, not an always-on onboarding promise: it defaults off, production requires a second explicit acknowledgement plus a healthy shared atomic limiter or explicitly trusted enforcing edge, disabled behavior is a non-enumerating 404, and forwarded client IP is trusted only from an allowlisted immediate proxy.
- Registration is at-most-once per durable idempotency key. The first committed 201 may reveal plaintext once; later same-request success replays disclose only non-secret result IDs in a 409, and a lost response never causes credential recovery/reissue. Raw idempotency keys, request bodies, success responses, plaintext, and hashes are never persisted or replayed.
- HTTP actor context is discriminated: JWT users have a database-confirmed active user, tenant, and exact current role; API keys have no user and always carry the fixed `finops_analyst` role plus the narrower explicit API-key allow-list. JWT claims are assertions only, and presenting both credential types is rejected rather than prioritized.
- User/key administration, approval decisions, account deactivation, price-table mutation, policy/settings/integration management, and audit access are JWT-only as specified by PRD §2b/§8b; an API key never elevates into an admin JWT.
- The application frame shows tenant display name and role; account IDs alone are not treated as global identifiers.
- A cross-tenant resource reference produces a non-enumerating `404`, not a reveal that the resource exists elsewhere.
- Hidden controls do not substitute for server authorization. Read-only and denied actions are enforced at the route/service boundary.
- Cache keys, HTMX fragments, browser history restoration, and exports must not cross tenant context.

### Audit boundary

- Mutations show actor, timestamp, resulting state, and a stable audit reference where one exists.
- Approval reason, expiry, rejection, supersession, and adapter configuration changes are auditable.
- The audit log is append-only in product semantics. Filters and export do not mutate source records.
- Sensitive credentials, raw API keys, internal solver IDs, retry counters, and unrelated provider payloads never appear in UI or logs.

### Replay boundary

- A recommendation’s economic identity is the frozen billing snapshot, price versions, forecast configuration/output, scenario, optimizer policy, seed, and approval thresholds.
- Report and approval re-renders use frozen snapshots, not current tenant names, current prices, or recomputed economics.
- “Replayed” means the same frozen inputs and deterministic seed were used; “backtested” additionally means only data available at each historical decision date was used.
- Changed live inputs create a new run or a superseding recommendation; they do not rewrite a prior decision.

These boundaries implement **Tenant-scoped by default**, **Standalone-first optimizer**, and **Replayable economics**. Optional adapters may mirror or trigger, but local recommendation, approval, report, and in-app notification state remains canonical. (PRD §2, PRD §5.6–§5.9, PRD §8)

## States and Error Semantics

Every asynchronous or consequential surface must render one of the following named states, with a plain-language explanation and a next action where one is safe:

| State | Meaning | Required presentation / next action |
|---|---|---|
| loading | Known content is being fetched or a submitted action is resolving | Preserve layout; identify the activity; disable duplicate submission without hiding navigation. |
| empty | The query succeeded and has no records | Explain why the surface matters and offer the role-appropriate first action. |
| success | The action completed and the source state is confirmed | Name the result and stable reference; do not use a color-only toast. |
| import quarantined | Required billing fields/control totals failed validation | Preserve source; list row/field categories and remediation; do not expose partial data as optimizer-ready. |
| forecast low confidence | Forecast completed with material quality warnings | Show warnings and conservative policy effect; never present ordinary “healthy” styling. |
| optimizer infeasible | No portfolio satisfies frozen policy constraints | Show binding constraints and ranked relaxations; keep no-action as the honest outcome. |
| recommendation blocked | A prerequisite such as active price data is missing/stale | Name the blocker and owning remediation route; do not invent economics. |
| approval expired | The decision window ended before a valid decision | Make actions unavailable and explain whether a new request/run is required. |
| adapter disabled | An optional ecosystem connection is intentionally off | State that standalone core remains available; offer configuration only to permitted admins. |
| adapter retrying | Local core succeeded but an optional mirror/trigger is retrying | Separate local state from external delivery status and show last attempt safely. |
| permission denied | The current role cannot perform the action | Return `403`, preserve readable context when permitted, and explain the required role without leaking data. |
| not found | The resource is absent or outside the tenant | Return `404` with no cross-tenant distinction. |
| network unavailable | The request cannot reach the server | Preserve entered non-secret form data where safe; do not queue optimizer or approval actions locally. |

API and HTMX failures use the canonical envelope with stable `error.code`, human-readable `error.message`, and non-sensitive `error.details`; for example `VALIDATION_ERROR`. HTMX swaps an error summary into the owning region, moves focus to that summary, retains valid values, and links field errors with `aria-describedby`. Authentication failure is `401`; authorization failure is `403`; inaccessible/absent tenant resources are `404`; conflicts such as stale version or duplicate decision are `409` where applicable. Registration additionally uses the exact PRD §8b 201/400/404/409/413/429/503 contract and renders every BIGINT/cents value as an unsigned canonical decimal string without JavaScript `Number` coercion. Unknown failures show a correlation reference, not a stack trace. (PRD §5b, PRD §8b)

## Responsive and Mobile Priorities

Desktop is the authoring and investigation workspace; mobile is read/triage/approve-first. Responsive behavior changes composition, not the integrity of the economic decision. (PRD §5b)

- **Desktop, 1440px target:** dense planning tables, persistent filters, frontier plus side-by-side scenario comparison, and visible provenance.
- **Tablet, 1024px target:** filter drawers, one primary analytical pane at a time, horizontal chart exploration, and sticky decision summary.
- **Mobile, 390px target:** dashboard triage, recommendation/approval reading, constraint and provenance review, reject/approve, and audit browsing remain complete with at least 44px touch targets.
- Bulk billing import, complex price-table editing, and frontier editing may recommend desktop, but must state why and preserve read-only status on mobile.
- Mobile approval order is fixed: action/status → expected saving and p95 downside → confidence/utilization → binding constraints → frozen inputs/provenance → decision reason → reject/approve.
- Dense tables transform to labeled record rows only when column relationships remain explicit; comparison tables may use controlled horizontal scroll with a sticky first column.
- No content or action is available only on hover. No critical control sits beneath a fixed mobile bar. Text resize to 200% and 400% zoom / 320 CSS px reflow must preserve information and operation without two-dimensional page scrolling.

## Privacy and Accessibility Expectations

### Privacy

- Billing exports may contain provider account IDs, tags, project names, cost-center labels, and user-authored metadata. Upload copy states this before selection and repeats scope before submission.
- Sharing an export, screenshot, trace, or report with support is a separate explicit action with a redaction preview; it is never implied by upload.
- Default display masks external account identifiers except for the final four characters. Authorized reveal is intentional, temporary, and excluded from routine telemetry.
- Optional ecosystem adapters require explicit tenant-admin enablement and show what event categories leave the standalone system. Disabled is a normal state.
- Sensitive reports are not browser/CDN cached. Clipboard and downloads require explicit user action and carry tenant/decision context.
- Product analytics is self-host compatible or disabled by default and must not capture raw billing rows, account identifiers, report bodies, decision reasons, or form values.

### Accessibility

- Target WCAG 2.1 AA: body text contrast at least 4.5:1; large text and meaningful graphics at least 3:1.
- All menus, filters, tables, chart tabs, dialogs, uploads, and approval actions are keyboard operable with visible focus.
- Semantic headings, landmarks, native controls, table captions/headers, and status announcements are the default.
- Every chart has a concise text summary and a semantically equivalent data table/CSV path. Risk is encoded by label, symbol/line treatment, and value—not color alone.
- Reduced motion removes chart interpolation, parallax, and nonessential transitions while preserving status changes.
- Errors are summarized, linked to fields, and announced; loading updates use restrained live regions.

These expectations are acceptance boundaries, not evidence claims. They trace to PRD §5b and the immutable/read-only role model in PRD §8.

## Success Metrics

### Decision quality

- 100% of recommendation summaries pair expected net saving with p95 downside, confidence/risk label, and named baseline.
- 100% of approved/rejected decisions expose frozen input provenance and an attributable decision reason.
- 0 recommendations proceed with missing/stale required price data or silently relaxed policy.
- Golden replay recommendations meet PRD economics: at least 5% net-savings improvement over the 70% utilization heuristic while staying within configured p95 downside budget. (PRD §15)

### Workflow quality

- A first-time approver can identify the action, downside limit, binding constraints, input freshness, and decision controls without opening a second screen.
- Import, forecast, optimizer, approval, adapter, and network failures always produce a named state and a safe next action.
- Mobile supports complete approval review/reject/approve and dashboard triage at 390px; authoring-only limits are explicit.
- Accessibility validation yields zero critical or serious violations on critical routes and all decision actions complete by keyboard.

### Performance and reliability

- Dashboard LCP is under 2.5 seconds at the PRD dataset target.
- First dashboard JavaScript is under 180KB gzip; charting and Parquet preview code load only on their owning screens.
- List/detail API p95 is under 250ms excluding queued jobs; UI distinguishes queued work from request latency. (PRD §10b)
- Client console errors and failed same-origin requests are zero in the critical-flow QA run.

### Privacy and trust

- Zero unredacted sensitive identifiers in screenshots, traces, analytics payloads, or support-share fixtures.
- Every adapter enablement names outbound event categories and requires an authorized explicit action.
- Snapshot re-render verification shows no change after tenant identity or price-table supersession. (PRD §15)

## Non-Goals

The UX must not imply or scaffold capabilities excluded by the canonical scope. (PRD §12)

- No live provider-side commitment purchase/execution in MVP; the product ends at an auditable recommendation, approval, export, and manual action boundary.
- No universal cloud cost dashboard, customer billing/subscription suite, Kubernetes autoscaler, or rightsizing engine.
- No direct email/SMS transport in core; use tenant-scoped in-app notifications and the optional Notification Hub mirror.
- No Invoice Reconciliation outbound path until an exact contract is verified; an unsafe enablement attempt fails before network activity.
- No marketplace for trading commitments; sell/exchange remains recommendation language only where provider rules support it.
- No real-time per-second operations telemetry, offline optimizer execution, broad SSO catalog, or custom secret vault.
- No decorative “AI copilot” that invents policy relaxations, savings, or explanations outside frozen optimizer evidence.

## PRD Traceability

| Product UX contract | Canonical source | Interface consequence |
|---|---|---|
| Audience, product promise, advisory scope | PRD §1, PRD §12 | Decision product for CFO/CTO/FinOps; no provider-side action claim. |
| Tenant-scoped by default | PRD §2, PRD §2b, PRD §8 | Tenant and role context govern every view/action; cross-tenant references do not enumerate. |
| Standalone-first optimizer | PRD §2, PRD §5.9 | Optional adapters are clearly separable from canonical local state. |
| Risk-bounded savings over headline savings | PRD §2, PRD §5.5 | Saving, downside, confidence, baseline, and constraints travel together. |
| Replayable economics | PRD §2, PRD §5.6, PRD §5.7 | Frozen input/version/seed provenance and immutable reports/approvals. |
| Explain before automate | PRD §2, PRD §5.5, PRD §5.7 | No action without constraints, baseline, risk budget, and human approval semantics. |
| Journeys, screens, responsive/state contract | PRD §5b | Desktop analysis; complete mobile triage/approval; named state hierarchy. |
| Role and immutability boundaries | PRD §8 | Role-specific controls, read-only economics, append-only audit semantics. |
| Error envelope | PRD §8b | Stable code/message/details rendered safely in HTMX regions. |
| Performance and observability | PRD §10b | LCP/API/bundle targets and honest queued-job status. |
| Explicit exclusions | PRD §12 | No scope inflation in copy, navigation, empty states, or calls to action. |
| Product acceptance | PRD §15 | Replay, snapshot, mobile, accessibility, privacy, bundle, and polish metrics remain measurable. |
