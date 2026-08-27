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
const requiredNames = ["name", "legal_name", "full_legal_name", "display_name"] as const;
const optionalStrings = [
  "contact_email",
  "contact_phone",
  "support_url",
  "finance_owner_email",
  "wordmark",
] as const;
const baseColumns = "name, legal_name, full_legal_name, display_name";
const baseValues = "$1, $2, $3, $4";
const baseInsert = `INSERT INTO tenants (${baseColumns}) VALUES (${baseValues})`;

let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_tenants_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("tenants defaults and generated values", () => {
  it("inserts two distinct tenants with duplicate names, Unicode, and structured addresses", async () => {
    const longLine = `42 ${"Long Structured Address ".repeat(40)}`;
    const first = await client.query<{ id: string }>(
      `INSERT INTO tenants (${baseColumns}, address, registration)
       VALUES (${baseValues}, $5::jsonb, $6::jsonb) RETURNING id`,
      [
        "Shared Portfolio",
        "Acme FinOps LLC",
        "Acme Financial Operations Limited Liability Company",
        "Acme Commitments",
        JSON.stringify({ line1: longLine, locality: "London", country_code: "GB" }),
        JSON.stringify({ GB: "12345678" }),
      ],
    );
    const second = await client.query<{ id: string }>(
      `INSERT INTO tenants (${baseColumns}, address, registration)
       VALUES (${baseValues}, $5::jsonb, $6::jsonb) RETURNING id`,
      [
        "Shared Portfolio",
        "Société Globex SAS",
        "Société Globex d’Optimisation Nuagique",
        "Globex Économies",
        JSON.stringify({ line1: "9 Rue du Nuage", locality: "Montréal", country_code: "CA" }),
        JSON.stringify({ QC: "NEQ-123" }),
      ],
    );

    expect(first.rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
  });

  it("applies metadata defaults without creating credentials", async () => {
    const result = await client.query<{
      address: object;
      registration: object;
      contact_email: string | null;
      default_currency: string;
      timezone: string;
      risk_budget_cents: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(`${baseInsert} RETURNING *`, ["Default", "Default", "Default", "Default"]);
    const tenant = result.rows[0];

    expect(tenant).toMatchObject({
      address: {},
      registration: {},
      contact_email: null,
      default_currency: "USD",
      timezone: "UTC",
      risk_budget_cents: "0",
      is_active: true,
    });
    expect(tenant?.created_at).toBeInstanceOf(Date);
    expect(tenant?.updated_at.getTime()).toBeGreaterThanOrEqual(tenant?.created_at.getTime() ?? 0);
  });

  it("advances updated_at while preserving created_at", async () => {
    const inserted = await client.query<{ id: string; created_at: Date; updated_at: Date }>(
      `${baseInsert} RETURNING id, created_at, updated_at`,
      ["Timestamp", "Timestamp", "Timestamp", "Timestamp"],
    );
    const before = inserted.rows[0];
    await client.query("SELECT pg_sleep(0.02)");
    const updated = await client.query<{ created_at: Date; updated_at: Date }>(
      "UPDATE tenants SET display_name = 'Timestamp changed' WHERE id = $1 RETURNING created_at, updated_at",
      [before?.id],
    );

    expect(updated.rows[0]?.created_at).toEqual(before?.created_at);
    expect(updated.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      before?.updated_at.getTime() ?? 0,
    );
  });
});

describe("tenants database checks", () => {
  for (const column of requiredNames) {
    it(`rejects blank or padded ${column}`, async () => {
      const values = ["Valid", "Valid", "Valid", "Valid"];
      values[requiredNames.indexOf(column)] = " padded ";
      await expect(client.query(baseInsert, values)).rejects.toThrow(/check constraint/iu);
      values[requiredNames.indexOf(column)] = "";
      await expect(client.query(baseInsert, values)).rejects.toThrow(/check constraint/iu);
    });
  }

  for (const column of optionalStrings) {
    it(`rejects blank or padded optional ${column}`, async () => {
      const sql = `INSERT INTO tenants (${baseColumns}, ${column}) VALUES (${baseValues}, $5)`;
      await expect(
        client.query(sql, ["Valid", "Valid", "Valid", "Valid", " padded "]),
      ).rejects.toThrow(/check constraint/iu);
      await expect(client.query(sql, ["Valid", "Valid", "Valid", "Valid", ""])).rejects.toThrow(
        /check constraint/iu,
      );
    });
  }

  it.each([
    ["scalar address", "address", JSON.stringify("not-an-object")],
    ["array address", "address", JSON.stringify(["not-an-object"])],
    ["scalar registration", "registration", JSON.stringify("not-an-object")],
    ["array registration", "registration", JSON.stringify(["not-an-object"])],
  ])("rejects %s JSON", async (_label, column, value) => {
    const sql = `INSERT INTO tenants (${baseColumns}, ${column}) VALUES (${baseValues}, $5::jsonb)`;
    await expect(client.query(sql, ["Valid", "Valid", "Valid", "Valid", value])).rejects.toThrow(
      /check constraint/iu,
    );
  });

  it.each([
    ["malformed currency", "default_currency", "US"],
    ["lowercase currency", "default_currency", "usd"],
    ["blank timezone", "timezone", ""],
    ["padded timezone", "timezone", " UTC "],
    ["negative risk", "risk_budget_cents", -1],
  ])("rejects %s", async (_label, column, value) => {
    const sql = `INSERT INTO tenants (${baseColumns}, ${column}) VALUES (${baseValues}, $5)`;
    await expect(client.query(sql, ["Valid", "Valid", "Valid", "Valid", value])).rejects.toThrow(
      /check constraint/iu,
    );
  });

  it("rejects timestamps where updated_at precedes created_at", async () => {
    await expect(
      client.query(
        `INSERT INTO tenants (${baseColumns}, created_at, updated_at)
         VALUES (${baseValues}, '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')`,
        ["Valid", "Valid", "Valid", "Valid"],
      ),
    ).rejects.toThrow(/check constraint/iu);
  });
});
