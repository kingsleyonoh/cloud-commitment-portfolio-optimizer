import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

async function tenant(label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_cloud_accounts_validation");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("cloud account metadata validation", () => {
  it.each(["", "   ", " Padded display "])(
    "rejects blank or padded display name %j",
    async (name) => {
      const tenantId = await tenant(`Invalid display ${JSON.stringify(name)}`);
      await expect(
        client.query(
          `INSERT INTO cloud_accounts
           (tenant_id, provider, external_ref, display_name, currency)
         VALUES ($1, 'aws', 'synthetic-display-account', $2, 'USD')`,
          [tenantId, name],
        ),
      ).rejects.toMatchObject({ constraint: "cloud_accounts_display_name_trimmed_check" });
    },
  );

  it.each(["usd", "Usd", " USD", "USD ", "US", "USDD", "12A"])(
    "rejects noncanonical currency %j",
    async (currency) => {
      const tenantId = await tenant(`Invalid currency ${JSON.stringify(currency)}`);
      await expect(
        client.query(
          `INSERT INTO cloud_accounts
             (tenant_id, provider, external_ref, display_name, currency)
           VALUES ($1, 'aws', 'synthetic-currency-account', 'Currency account', $2)`,
          [tenantId, currency],
        ),
      ).rejects.toMatchObject({ constraint: "cloud_accounts_currency_shape_check" });
    },
  );

  it.each(["[]", '"tag"', "null"])("rejects non-object tags %s", async (tags) => {
    const tenantId = await tenant(`Invalid tags ${tags}`);
    await expect(
      client.query(
        `INSERT INTO cloud_accounts
           (tenant_id, provider, external_ref, display_name, currency, tags)
         VALUES ($1, 'aws', 'synthetic-tags-account', 'Tags account', 'USD', $2::jsonb)`,
        [tenantId, tags],
      ),
    ).rejects.toMatchObject({ constraint: "cloud_accounts_tags_object_check" });
  });

  it("rejects null active status and does not expose a duplicate status column", async () => {
    const tenantId = await tenant("Invalid active status tenant");
    await expect(
      client.query(
        `INSERT INTO cloud_accounts
           (tenant_id, provider, external_ref, display_name, currency, is_active)
         VALUES ($1, 'aws', 'synthetic-null-active', 'Null active', 'USD', NULL)`,
        [tenantId],
      ),
    ).rejects.toThrow(/null value.*is_active/iu);
    await expect(
      client.query(
        `INSERT INTO cloud_accounts
           (tenant_id, provider, external_ref, display_name, currency, status)
         VALUES ($1, 'aws', 'synthetic-status-column', 'Status column', 'USD', 'active')`,
        [tenantId],
      ),
    ).rejects.toThrow(/column "status".*does not exist/iu);
  });

  it("rejects reversed creation/update chronology", async () => {
    const tenantId = await tenant("Invalid timestamp tenant");
    await expect(
      client.query(
        `INSERT INTO cloud_accounts
           (tenant_id, provider, external_ref, display_name, currency, created_at, updated_at)
         VALUES ($1, 'aws', 'synthetic-reversed-time', 'Reversed time', 'USD',
                 '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [tenantId],
      ),
    ).rejects.toMatchObject({ constraint: "cloud_accounts_timestamps_ordered_check" });
  });
});
