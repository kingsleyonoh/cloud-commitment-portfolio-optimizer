# Interpreting the efficient frontier

The efficient frontier shows feasible commitment choices ordered by risk and expected net savings. The no-commitment baseline remains visible. Read each point as a pair: expected net saving after unused-commitment waste and p95 downside loss under the frozen forecast draws.

1. Confirm the point is feasible under the active policy and uses the frozen price-table version.
2. Compare it with the no-commitment and configured utilization baselines.
3. Identify the binding constraint: downside budget, utilization gap, minimum saving, stale data, or instrument allow-list.
4. Prefer the smallest commitment that meets the required saving and approval policy unless a larger point has a defensible risk trade-off.

An infeasible frontier is an honest result. The API preserves ranked relaxation suggestions; it does not substitute fallback pricing or hide the reason a provider/instrument combination was excluded. The UI's table is the accessible alternative to a chart.
