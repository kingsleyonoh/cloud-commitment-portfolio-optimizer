import type { Pool, QueryResultRow } from "pg";

export interface QueueLagMetric {
  depth: number;
  lagSeconds: number;
}

interface QueueMetricRow extends QueryResultRow {
  depth: string;
  lagSeconds: string;
}

export async function measureQueueLag(pool: Pool, now = new Date()): Promise<QueueLagMetric> {
  const result = await pool.query<QueueMetricRow>(
    `SELECT count(*)::text AS "depth",
            COALESCE(max(EXTRACT(EPOCH FROM ($1::timestamptz - created_at))), 0)::text AS "lagSeconds"
       FROM (
         SELECT created_at FROM import_batches WHERE status IN ('queued', 'processing')
         UNION ALL
         SELECT created_at FROM forecast_runs WHERE status IN ('queued', 'running')
         UNION ALL
         SELECT created_at FROM optimizer_runs WHERE status IN ('queued', 'running')
         UNION ALL
         SELECT created_at FROM backtest_runs WHERE status IN ('queued', 'running')
         UNION ALL
         SELECT created_at FROM report_snapshots WHERE status = 'queued'
         UNION ALL
         SELECT created_at FROM ecosystem_events WHERE status IN ('queued', 'retrying')
       ) queued`,
    [now.toISOString()],
  );
  const row = result.rows[0]!;
  return {
    depth: Number.parseInt(row.depth, 10),
    lagSeconds: Math.max(0, Number.parseFloat(row.lagSeconds)),
  };
}
