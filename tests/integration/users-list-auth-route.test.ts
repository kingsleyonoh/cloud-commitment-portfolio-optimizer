import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  usersToken,
  type UsersHarness,
} from "./helpers/users-app.js";

let harness: UsersHarness;

beforeAll(async () => {
  harness = await createUsersHarness("ccpo_users_list");
});

afterAll(async () => {
  await closeUsersHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("GET /api/users", () => {
  it("allows only a database-confirmed tenant_admin JWT", async () => {
    const allowed = await harness.app.inject({
      method: "GET",
      url: "/api/users",
      headers: usersAuthorization(harness),
    });
    expect(allowed.statusCode).toBe(200);

    for (const role of ["finops_analyst", "finance_approver", "read_only_auditor"] as const) {
      const denied = await harness.app.inject({
        method: "GET",
        url: "/api/users",
        headers: usersAuthorization(harness, role, role),
      });
      expect(denied.statusCode, role).toBe(403);
      expect(denied.json().error.code, role).toBe("FORBIDDEN");
    }
    const apiKey = await harness.app.inject({
      method: "GET",
      url: "/api/users",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(apiKey.statusCode).toBe(403);
    expect(apiKey.json().error.code).toBe("FORBIDDEN");

    const dual = await harness.app.inject({
      method: "GET",
      url: "/api/users",
      headers: {
        ...usersAuthorization(harness),
        "x-api-key": harness.analystApiKey,
      },
    });
    expect(dual.statusCode).toBe(401);
    expect(dual.json().error.code).toBe("AUTH_CREDENTIAL_CONFLICT");
  });

  it("returns tenant-only exact seven-field metadata with default page size", async () => {
    for (let index = 0; index < 24; index += 1) {
      await harness.pool.query(
        `INSERT INTO users (tenant_id, email, name, role, created_at, updated_at)
         VALUES ($1, $2, $3, 'finops_analyst',
                 '2026-01-01T00:00:00.000000Z'::timestamptz,
                 '2026-01-01T00:00:00.000000Z'::timestamptz)`,
        [harness.tenantA, `list-${index}@tenant-a.example.invalid`, `List ${index}`],
      );
    }
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/users",
      headers: usersAuthorization(harness),
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(body.users).toHaveLength(25);
    expect(body.next_cursor).toEqual(expect.any(String));
    for (const user of body.users) {
      expect(Object.keys(user)).toEqual([
        "id",
        "email",
        "name",
        "role",
        "is_active",
        "created_at",
        "updated_at",
      ]);
      expect(user.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    }
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toContain("hidden-marker@tenant-b.example.invalid");
    expect(response.body).not.toMatch(/(?:tenant_id|password|token|api.?key|hash)/iu);
  });

  it("traverses immutable tied keysets without duplicates and excludes a newer insert", async () => {
    const initial = await harness.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = $1",
      [harness.tenantA],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    let insertedId = "";
    do {
      const query = new URLSearchParams({ limit: "10" });
      if (cursor) query.set("cursor", cursor);
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/users?${query}`,
        headers: usersAuthorization(harness),
      });
      expect(response.statusCode).toBe(200);
      const page = response.json();
      seen.push(...page.users.map((user: { id: string }) => user.id));
      cursor = page.next_cursor;
      if (!insertedId) {
        const inserted = await harness.pool.query<{ id: string }>(
          `INSERT INTO users
             (tenant_id, email, name, role, created_at, updated_at)
           VALUES ($1, 'newer-after-page@example.invalid', 'Newer', 'finops_analyst',
                   now() + interval '1 hour', now() + interval '1 hour') RETURNING id`,
          [harness.tenantA],
        );
        insertedId = inserted.rows[0]!.id;
        await harness.pool.query(
          "UPDATE users SET name = name || ' updated' WHERE id = $1 AND tenant_id = $2",
          [initial.rows.at(-1)!.id, harness.tenantA],
        );
      }
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(insertedId);
    expect([...seen].sort()).toEqual(initial.rows.map(({ id }) => id).sort());
  });

  it("rejects malformed, tampered, foreign, and unknown query values generically", async () => {
    const first = await harness.app.inject({
      method: "GET",
      url: "/api/users?limit=1",
      headers: usersAuthorization(harness),
    });
    const cursor = first.json().next_cursor as string;
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    for (const query of [
      "limit=0",
      "limit=01",
      `cursor=${tampered}`,
      `tenant_id=${harness.tenantB}`,
    ]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/users?${query}`,
        headers: usersAuthorization(harness),
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json(), query).toEqual({
        error: { code: "VALIDATION_ERROR", message: "Request is invalid.", details: [] },
      });
    }
  });

  it("retains generic stale JWT rejection", async () => {
    const stale = await harness.app.inject({
      method: "GET",
      url: "/api/users",
      headers: {
        authorization: `Bearer ${usersToken(harness, "finops_analyst", "tenant_admin")}`,
      },
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error.code).toBe("AUTH_INVALID");
  });
});
