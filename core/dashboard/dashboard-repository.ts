import type { Pool, QueryResultRow } from "pg";

import type {
  DashboardImportStatus,
  DashboardRecentRecommendation,
  DashboardRecommendationStatus,
  DashboardTenant,
} from "./dashboard-types.js";

export interface DashboardRepository {
  getTenant(tenantId: string): Promise<DashboardTenant | null>;
  listImportStatuses(tenantId: string): Promise<DashboardImportStatus[]>;
  listRecommendationStatuses(tenantId: string): Promise<DashboardRecommendationStatus[]>;
  listRecentRecommendations(tenantId: string): Promise<DashboardRecentRecommendation[]>;
}

interface TenantRow extends QueryResultRow {
  displayName: string;
  defaultCurrency: string;
  riskBudgetCents: string;
  timezone: string;
}

interface ImportStatusRow extends QueryResultRow {
  status: string;
  count: number;
  latestAt: Date | null;
}

interface RecommendationStatusRow extends QueryResultRow {
  status: string;
  riskBand: string;
  count: number;
  expectedSavingsCents: string;
  p95DownsideLossCents: string;
}

interface RecentRecommendationRow extends QueryResultRow {
  id: string;
  recommendationType: string;
  provider: string;
  instrument: string;
  expectedSavingsCents: string;
  p95DownsideLossCents: string;
  riskBand: string;
  status: string;
  createdAt: Date;
}

export function createDashboardRepository(pool: Pick<Pool, "query">): DashboardRepository {
  return {
    async getTenant(tenantId) {
      const result = await pool.query<TenantRow>(
        `SELECT display_name AS "displayName",
                default_currency AS "defaultCurrency",
                risk_budget_cents::text AS "riskBudgetCents",
                timezone
           FROM tenants
          WHERE id = $1 AND is_active = true
          LIMIT 1`,
        [tenantId],
      );
      return result.rows[0] ?? null;
    },
    async listImportStatuses(tenantId) {
      const result = await pool.query<ImportStatusRow>(
        `SELECT status,
                count(*)::int AS count,
                max(created_at) AS "latestAt"
           FROM import_batches
          WHERE tenant_id = $1
          GROUP BY status
          ORDER BY status ASC`,
        [tenantId],
      );
      return result.rows.map((row) => ({
        status: row.status,
        count: row.count,
        latestAt: row.latestAt?.toISOString() ?? null,
      }));
    },
    async listRecommendationStatuses(tenantId) {
      const result = await pool.query<RecommendationStatusRow>(
        `SELECT status,
                risk_band AS "riskBand",
                count(*)::int AS count,
                coalesce(sum(expected_savings_cents), 0)::text AS "expectedSavingsCents",
                coalesce(sum(p95_downside_loss_cents), 0)::text AS "p95DownsideLossCents"
           FROM recommendations
          WHERE tenant_id = $1
          GROUP BY status, risk_band
          ORDER BY status ASC, risk_band ASC`,
        [tenantId],
      );
      return result.rows.map((row) => ({ ...row }));
    },
    async listRecentRecommendations(tenantId) {
      const result = await pool.query<RecentRecommendationRow>(
        `SELECT id::text,
                recommendation_type AS "recommendationType",
                provider,
                instrument,
                expected_savings_cents::text AS "expectedSavingsCents",
                p95_downside_loss_cents::text AS "p95DownsideLossCents",
                risk_band AS "riskBand",
                status,
                created_at AS "createdAt"
           FROM recommendations
          WHERE tenant_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 5`,
        [tenantId],
      );
      return result.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  };
}
