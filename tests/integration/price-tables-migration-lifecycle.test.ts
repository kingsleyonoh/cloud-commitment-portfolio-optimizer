import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertPriceItem,
  insertPriceTenant,
  insertPriceVersion,
} from "./helpers/price-tables-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;
let tenantA: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_price_tables_lifecycle");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertPriceTenant(client, "price lifecycle tenant a");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

function digest(label: string): string {
  return createHash("sha256").update(`synthetic:${label}`).digest("hex");
}

async function version(label: string, tenantId = tenantA, effectiveTo: string | null = null) {
  const result = await insertPriceVersion(client, tenantId, {
    versionLabel: label,
    checksum: digest(`${tenantId}:${label}`),
    effectiveTo,
  });
  return result.rows[0]!;
}

async function versionWithItem(label: string, effectiveTo: string | null = null) {
  const created = await version(label, tenantA, effectiveTo);
  await insertPriceItem(client, tenantA, created.id, { sku: `sku-${label}` });
  return created;
}

describe("frozen version and item snapshots", () => {
  it("requires draft creation then permits only forward status transitions", async () => {
    await expect(
      insertPriceVersion(client, tenantA, {
        versionLabel: "direct-active",
        checksum: digest("direct-active"),
        status: "active",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      message: "price table versions must be created as draft",
    });
    const created = await versionWithItem("forward-status");
    const activated = await client.query<{ status: string; advanced: boolean }>(
      `UPDATE price_table_versions SET status = 'active'
       WHERE id = $1 RETURNING status, updated_at >= created_at AS advanced`,
      [created.id],
    );
    expect(activated.rows[0]).toEqual({ status: "active", advanced: true });
    const superseded = await client.query<{ status: string }>(
      "UPDATE price_table_versions SET status = 'superseded' WHERE id = $1 RETURNING status",
      [created.id],
    );
    expect(superseded.rows[0]).toEqual({ status: "superseded" });
    await expect(
      client.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [created.id]),
    ).rejects.toMatchObject({
      code: "55000",
      message: "invalid price table version status transition",
    });
  });

  it("allows draft or active to become blocked and treats blocked as terminal", async () => {
    const draft = await version("blocked-draft");
    await expect(
      client.query("UPDATE price_table_versions SET status = 'blocked' WHERE id = $1", [draft.id]),
    ).resolves.toBeDefined();
    await expect(
      client.query("UPDATE price_table_versions SET status = 'draft' WHERE id = $1", [draft.id]),
    ).rejects.toMatchObject({
      code: "55000",
      message: "invalid price table version status transition",
    });
    const active = await versionWithItem("blocked-active");
    await client.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
      active.id,
    ]);
    await expect(
      client.query("UPDATE price_table_versions SET status = 'blocked' WHERE id = $1", [active.id]),
    ).resolves.toBeDefined();
  });

  it.each(["version_label", "checksum", "effective_to", "source_uri", "provider", "instrument"])(
    "rejects frozen version identity mutation of %s",
    async (column) => {
      const created = await version(`immutable-${column}`);
      const values: Record<string, string> = {
        version_label: "changed-label",
        checksum: digest("changed-checksum"),
        effective_to: "2026-12-31",
        source_uri: "prices/synthetic/changed.json",
        provider: "azure",
        instrument: "aws_reserved_instance",
      };
      await expect(
        client.query(`UPDATE price_table_versions SET ${column} = $1 WHERE id = $2`, [
          values[column],
          created.id,
        ]),
      ).rejects.toMatchObject({
        code: "55000",
        message: "price table version identity is immutable",
      });
    },
  );

  it("rejects ordinary version updates and all item updates/deletes", async () => {
    const created = await versionWithItem("immutable-items");
    const item = await client.query<{ id: string }>(
      "SELECT id FROM price_table_items WHERE price_table_version_id = $1",
      [created.id],
    );
    await expect(
      client.query("UPDATE price_table_versions SET status = status WHERE id = $1", [created.id]),
    ).rejects.toMatchObject({
      code: "55000",
      message: "invalid price table version status transition",
    });
    await expect(
      client.query("UPDATE price_table_items SET hourly_rate_cents = '1' WHERE id = $1", [
        item.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "price table items are immutable" });
    await expect(
      client.query("DELETE FROM price_table_items WHERE id = $1", [item.rows[0]!.id]),
    ).rejects.toMatchObject({ code: "55000", message: "price table items are immutable" });
  });

  it("rejects item insertion after activation and preserves frozen economics", async () => {
    const created = await versionWithItem("active-insert");
    await client.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
      created.id,
    ]);
    await expect(
      insertPriceItem(client, tenantA, created.id, { sku: "late-item" }),
    ).rejects.toMatchObject({
      code: "55000",
      message: "price table items require a draft version",
    });
    const stored = await client.query<{ hourly_rate_cents: string }>(
      "SELECT hourly_rate_cents FROM price_table_items WHERE price_table_version_id = $1",
      [created.id],
    );
    expect(stored.rows).toEqual([{ hourly_rate_cents: "123456789" }]);
    await client.query("UPDATE price_table_versions SET status = 'superseded' WHERE id = $1", [
      created.id,
    ]);
  });

  it("rejects overlapping active periods and accepts a non-overlapping successor", async () => {
    const first = await versionWithItem("period-first", "2026-06-30");
    await client.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
      first.id,
    ]);
    const overlap = await versionWithItem("period-overlap", "2026-12-31");
    await expect(
      client.query(
        "UPDATE price_table_versions SET effective_from = effective_from, status = 'active' WHERE id = $1",
        [overlap.id],
      ),
    ).rejects.toMatchObject({
      code: "23P01",
      message: "active price table effective periods overlap",
    });
    const successor = await insertPriceVersion(client, tenantA, {
      versionLabel: "period-successor",
      checksum: digest("period-successor"),
      effectiveFrom: "2026-07-01",
      effectiveTo: "2026-12-31",
    });
    await insertPriceItem(client, tenantA, successor.rows[0]!.id, { sku: "sku-period-successor" });
    await expect(
      client.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
        successor.rows[0]!.id,
      ]),
    ).resolves.toBeDefined();
  });
});
