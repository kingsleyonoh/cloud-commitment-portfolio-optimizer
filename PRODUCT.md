# Cloud Commitment Portfolio Optimizer — Product Brief

## One-Liner

Buy cloud commitments like a portfolio, not a spreadsheet guess.

## Audience

CFOs, CTOs, and Heads of FinOps at SaaS companies with meaningful AWS/Azure/GCP spend who need to decide whether to buy, resize, renew, sell/exchange, or avoid cloud commitments under uncertain usage.

## Problem

Cloud Savings Plans, Reserved Instances, Azure Reservations/Savings Plans, and GCP committed-use discounts can reduce spend, but teams often overbuy because spreadsheets optimize headline savings from average usage. The real decision includes downside risk, liquidity lock-in, stale price tables, forecast quality, approval controls, and explainability.

## Product Promise

A self-hostable FinOps decision system that imports billing exports and price tables, forecasts eligible usage as distributions, simulates downside scenarios, builds efficient commitment portfolios, and produces auditable recommendations with deterministic backtests.

## Core Principles

- Tenant-scoped by default; self-hosted single user is tenant #1.
- Standalone-first; all core flows work with optional integrations disabled.
- Risk-bounded savings over headline savings.
- Replayable economics from frozen snapshots, versioned inputs, policies, and seeds.
- Explain before automate; recommendations expose constraints, baselines, confidence, and downside.

## MVP User Journeys

1. First run: setup tenant → create API key/user → create cloud account → import synthetic/AWS billing CSV → activate price fixtures → run forecast → run optimizer → view recommendation report.
2. Monthly planning: import latest billing → review forecast warnings → compare efficient frontier/scenario → request approval for high-value recommendation.
3. Finance approval: review frozen report → approve/reject → export HTML/PDF.
4. Backtest credibility: replay historical decisions against baselines → tune risk policy.
5. Integrations: optionally enable Notification Hub or Workflow Engine while keeping local core canonical.

## Primary Features

- Tenant/auth/RBAC with API key and JWT UI sessions.
- Billing import and normalization for AWS/Azure/GCP/synthetic fixture formats by phase.
- Versioned commitment price tables and stale-price blocking.
- Forecast models with distribution outputs and quality metrics.
- Zig economic kernel and optimizer for risk-bounded portfolios.
- Recommendation persistence, efficient frontier summaries, and immutable reports.
- Approval workflow and report snapshots.
- Deterministic backtests with no future leakage.
- Local in-app notifications and user preferences.
- Optional Notification Hub and Workflow Engine adapters.
- Disabled future Invoice Reconciliation placeholder with fail-safe config validation.

## What Not To Build

- Live cloud commitment purchasing in MVP.
- Generic cloud cost dashboard clone.
- Direct email/SMS provider dependency in core.
- Kubernetes autoscaling, rightsizing, or SaaS billing platform.
- Secret vault implementation.
- Active Invoice Reconciliation calls before endpoint contract verification.

## Success Criteria

- Self-hosted user can import fixture data, forecast, optimize, and view a recommendation with ecosystem services disabled.
- All owned-phase coverage matrix cells have real parser/route/optimizer/RBAC tests and UI/API evidence.
- Golden import totals reconcile by provider/service/region/month.
- Recommendations beat the 70% utilization heuristic by at least 5% net savings while staying within p95 downside budget.
- 12-month replay over 1M line items completes under 60 seconds on target runner.
- Approval and report snapshots remain unchanged after tenant and price-table edits.
- Optional adapters never block core flow when disabled/unavailable.
