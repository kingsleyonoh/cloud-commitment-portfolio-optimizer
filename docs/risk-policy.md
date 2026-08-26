# Risk policy tuning

An optimizer policy is tenant-scoped and should be tuned with a replay, not a single-month saving estimate. The key controls are the maximum p95 downside loss, minimum expected saving, utilization-gap tolerance, approval threshold, allowed instruments, and liquidity penalty.

Start with a conservative downside budget, run a 12-month backtest, and inspect the frontier. Increase commitment only when the candidate remains feasible across the held-out demand distribution and the p95 downside stays within budget. A low-confidence forecast, stale price table, concentrated spike, or missing provider coverage should produce a warning, block, or `manual_review` recommendation—not a green savings claim.

All money values in API and snapshot contracts are decimal strings of integer cents. Percentages are display-rounded; the economic kernel keeps the higher internal precision. Changing a policy creates a new optimizer run and does not mutate a frozen report or approval snapshot.
