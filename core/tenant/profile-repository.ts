import type { Pool, QueryResultRow } from "pg";

import type { RegistrationTenantRow } from "./registration-profile.js";

export interface TenantProfileRepository {
  findActiveById(tenantId: string): Promise<RegistrationTenantRow | null>;
}

interface TenantProfileRow extends QueryResultRow, RegistrationTenantRow {}

export function createTenantProfileRepository(pool: Pick<Pool, "query">): TenantProfileRepository {
  return {
    async findActiveById(tenantId) {
      const result = await pool.query<TenantProfileRow>(
        `SELECT id, name,
                legal_name AS "legalName",
                full_legal_name AS "fullLegalName",
                display_name AS "displayName",
                address,
                registration,
                contact_email AS "contactEmail",
                contact_phone AS "contactPhone",
                support_url AS "supportUrl",
                finance_owner_email AS "financeOwnerEmail",
                wordmark,
                default_currency AS "defaultCurrency",
                timezone,
                risk_budget_cents::text AS "riskBudgetCents",
                is_active AS "isActive",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM tenants
         WHERE id = $1 AND is_active = true
         LIMIT 1`,
        [tenantId],
      );
      return result.rows[0] ?? null;
    },
  };
}
