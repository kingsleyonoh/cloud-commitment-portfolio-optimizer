import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSetup } from "../../core/db/setup.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";
import { queryOne, safeFirstRunSnapshot } from "./helpers/first-run-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let passwordDirectory: string | undefined;
let adminPasswordFile = "";

function setupOptions(admin = false) {
  return {
    databaseUrl: database!.url,
    migrationsDirectory,
    tenant: {
      defaultTenantName: "  Cafe\u0301 Portfolio  ",
      defaultAdminEmail: admin ? "admin@example.invalid" : "",
      defaultAdminName: admin ? "Ada Admin" : "",
      defaultAdminPasswordFile: admin ? adminPasswordFile : "",
      apiKeyPrefix: "ccpo",
    },
  };
}

async function freshDatabase(prefix: string): Promise<void> {
  database = await createIsolatedDatabase(prefix);
  passwordDirectory = await mkdtemp(join(tmpdir(), "ccpo-setup-runner-"));
  adminPasswordFile = join(passwordDirectory, "password");
  const value = Array.from({ length: 18 }, (_, index) =>
    String.fromCodePoint(0x61 + (index % 24)),
  ).join("");
  await writeFile(adminPasswordFile, value, { mode: 0o600 });
}

afterEach(async () => {
  await dropIsolatedDatabase(database);
  database = undefined;
  if (passwordDirectory) await rm(passwordDirectory, { recursive: true });
  passwordDirectory = undefined;
  adminPasswordFile = "";
});

describe.sequential("typed first-run setup", () => {
  it("runs accepted migrations then atomically creates tenant defaults and one hash-only key", async () => {
    await freshDatabase("ccpo_setup_create");
    const result = await runSetup(setupOptions());
    const snapshot = await safeFirstRunSnapshot(database!.url);
    const tenant = await queryOne<{
      name: string;
      legalName: string;
      fullLegalName: string;
      displayName: string;
      address: object;
      registration: object;
      emptyContacts: boolean;
    }>(
      database!.url,
      `SELECT name, legal_name AS "legalName", full_legal_name AS "fullLegalName",
        display_name AS "displayName", address, registration,
        contact_email IS NULL AND contact_phone IS NULL AND support_url IS NULL
          AND finance_owner_email IS NULL AND wordmark IS NULL AS "emptyContacts"
       FROM tenants`,
    );

    expect(result.migrations.applied.length).toBe(20);
    expect(result.initialization.created).toBe(true);
    expect("apiKey" in result.initialization).toBe(true);
    expect(snapshot).toEqual({
      tenantCount: 1,
      userCount: 0,
      keyCount: 1,
      markerCount: 1,
      activeMarkerCount: 1,
      hashShapeCount: 1,
    });
    expect(tenant).toEqual({
      name: "Café Portfolio",
      legalName: "Café Portfolio",
      fullLegalName: "Café Portfolio",
      displayName: "Café Portfolio",
      address: {},
      registration: {},
      emptyContacts: true,
    });
  });

  it("creates the optional canonical tenant admin in the same transaction", async () => {
    await freshDatabase("ccpo_setup_admin");
    const result = await runSetup(setupOptions(true));
    const snapshot = await safeFirstRunSnapshot(database!.url);
    const admin = await queryOne<{
      email: string;
      name: string;
      role: string;
      isActive: boolean;
    }>(database!.url, `SELECT email, name, role, is_active AS "isActive" FROM users`);

    expect(result.initialization.created).toBe(true);
    expect(snapshot.userCount).toBe(1);
    expect(admin).toEqual({
      email: "admin@example.invalid",
      name: "Ada Admin",
      role: "tenant_admin",
      isActive: true,
    });
  });

  it("returns identifiers without plaintext when the exact initialized state exists", async () => {
    await freshDatabase("ccpo_setup_rerun");
    const first = await runSetup(setupOptions(true));
    const second = await runSetup(setupOptions(true));
    const snapshot = await safeFirstRunSnapshot(database!.url);
    const sameIdentifiers =
      first.initialization.tenantId === second.initialization.tenantId &&
      first.initialization.apiKeyId === second.initialization.apiKeyId &&
      first.initialization.adminUserId === second.initialization.adminUserId;

    expect(first.initialization.created).toBe(true);
    expect(second.initialization.created).toBe(false);
    expect("apiKey" in second.initialization).toBe(false);
    expect(sameIdentifiers).toBe(true);
    expect(snapshot).toMatchObject({ tenantCount: 1, userCount: 1, keyCount: 1, markerCount: 1 });
  });
});
