# Cloud Commitment Portfolio Optimizer — Design Brief

## Product Tone

A sober FinOps command center: high-trust financial controls, dense but legible data, explicit risk context, and audit-grade confidence. The interface should feel closer to treasury/risk software than a generic SaaS dashboard.

## Visual Direction

- Palette: dark navy/slate foundation, off-white surfaces, restrained blue accents, amber/red for risk, green only when paired with downside context.
- Typography: compact, tabular-number-friendly, high contrast. Use clear hierarchy over decorative display type.
- Layout: dense desktop tables and charts, but with strong spacing, pinned summaries, and progressive disclosure.
- Motion: minimal and reduced-motion compatible; use transitions only to clarify state changes.

## Core UI Surfaces

- Landing page: pain → replay proof → optimizer method → UI preview → optional integrations → self-host setup → CTA.
- Dashboard: portfolio summary, open approvals, import health, risk-band trends, forecast quality warnings.
- Imports: upload flow, parser status, quarantine review, control totals.
- Price Tables: version list, active/stale/blocked status, activation workflow.
- Forecasts/Scenarios: model configuration, quality metrics, distribution summaries, shock comparison.
- Optimizer Runs: policy selection, efficient frontier chart, infeasible details, run history.
- Recommendation Detail: CFO-facing report with expected savings, p95 downside, utilization percentiles, confidence, binding constraints, frozen inputs.
- Approvals: mobile-friendly review, approve/reject, expiry/assignment status.
- Backtests: net savings, regret, baseline comparison, no-future-leakage explanation.
- Integrations: disabled/degraded/healthy states for optional adapters.
- Settings: tenant identity, users, risk defaults, notification preferences.

## Responsive Behavior

- Desktop 1440px: dense planning tables, side-by-side scenario comparisons, frontier charts, filters visible.
- Tablet 1024px: filters collapse into drawers, chart/table pairs stack, horizontal scroll only for data grids with visible affordance.
- Mobile 390px: approval review, dashboard triage, report summary, notifications, and critical actions remain usable with 44px touch targets. Bulk import and frontier editing can direct users to desktop.

## Accessibility

- Target WCAG 2.1 AA.
- Full keyboard navigation for menus, tables, filters, chart tabs, dialogs, and approval actions.
- Semantic tables for all dense financial data.
- Charts must have text summaries and accessible data-table/CSV alternatives.
- Risk cannot be represented by color alone; use labels, icons, and explanatory text.
- Visible focus states and reduced-motion chart behavior are mandatory.

## State Hierarchy

Design explicit states for: loading, empty, import quarantined, parser warnings, forecast low confidence, optimizer infeasible, recommendation blocked, approval pending/approved/rejected/expired, adapter disabled, adapter retrying/degraded, permission denied, success, and network/service unavailable.

## Copy and Trust Rules

- Never show vague “You saved money” claims without baseline, downside loss, confidence, and frozen price version.
- CFO-facing language should be precise: “Expected net savings,” “p95 downside loss,” “binding constraint,” “price table version,” “forecast quality.”
- Upload flows must warn that billing exports may include account IDs/tags and require explicit consent before support sharing.
- Optional integrations should be opt-in and explain that local recommendations/reports remain canonical.

## Anti-Patterns

- Generic green savings badges with no downside context.
- Decorative charts without underlying data tables.
- Hidden tenant/price/forecast assumptions.
- Auto-purchase UX or language that implies commitments are executed automatically.
- Dense tables with tiny touch targets on mobile.
- Silent disabled integrations or ambiguous “failed” messages.

## Performance Guidance

- First dashboard JavaScript under 180KB gzip.
- Dynamically import heavy charting and Parquet previews only on relevant screens.
- Paginate large tables and keep filters server-backed.
- Prefer HTMX/server-rendered interactions for core flows; use React only for isolated interactive components that justify client state.

## Evidence Gates

UI completion requires: mobile viewport pass, WCAG/a11y pass, privacy matrix pass, dynamic import/bundle audit pass, frontend polish pass, and Playwright coverage for first-run/recommendation/approval flows.
