import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  insertIdentityFixtures,
  readFixtureBundle,
} from "../factories/identity-fixture-database.js";
import { apiKeyMetadataFixtures } from "../fixtures/api-key-metadata.js";
import { tenantFixtures } from "../fixtures/tenants.js";
import { userFixtures } from "../fixtures/users.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_fixture_roundtrip");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: resolve("db/migrations") });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("accepted-migration fixture ownership round-trip", () => {
  it("round-trips tenant, user, and safe key metadata without cross-tenant ownership leakage", async () => {
    await insertIdentityFixtures(client);
    for (const tenant of Object.values(tenantFixtures)) {
      const bundle = await readFixtureBundle(client, tenant.id);
      const expectedUsers = userFixtures
        .filter(({ tenantId }) => tenantId === tenant.id)
        .sort((a, b) => a.id.localeCompare(b.id));
      const expectedMetadata = apiKeyMetadataFixtures
        .filter(({ tenantId }) => tenantId === tenant.id)
        .sort((a, b) => a.id.localeCompare(b.id));

      expect(bundle.tenant).toEqual([tenant]);
      expect(bundle.users).toEqual(expectedUsers);
      expect(bundle.metadata).toEqual(expectedMetadata);
      const otherTenant = Object.values(tenantFixtures).find(({ id }) => id !== tenant.id)!;
      expect(JSON.stringify(bundle)).not.toContain(otherTenant.id);
    }
  });
});
