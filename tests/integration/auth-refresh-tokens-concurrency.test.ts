import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  insertRefreshFamily,
  insertRefreshTenant,
  insertRefreshToken,
  insertRefreshUser,
} from "./helpers/auth-refresh-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let setup: Client;

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: database!.url });
  await client.connect();
  return client;
}

async function familyWithRoot(label: string): Promise<[string, string, string]> {
  const tenantId = await insertRefreshTenant(setup, `${label} tenant`);
  const userId = await insertRefreshUser(setup, tenantId, `${label}-${randomUUID()}`);
  const familyId = await insertRefreshFamily(setup, tenantId, userId);
  const rootId = await insertRefreshToken(setup, tenantId, familyId);
  return [tenantId, familyId, rootId];
}

async function waitUntilBlocked(observer: Client, blockedPid: number, blockerPid: number) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ blocked: boolean }>(
      "SELECT $2 = ANY(pg_blocking_pids($1)) AS blocked",
      [blockedPid, blockerPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("refresh contender did not block on the stable family row");
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_refresh_concurrency");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  setup = await connect();
});

afterAll(async () => {
  if (setup) await setup.end();
  await dropIsolatedDatabase(database);
});

describe("stable family mutex and rotating-token races", () => {
  it("serializes child rotation before replay revokes the authoritative family", async () => {
    const [tenantId, familyId, rootId] = await familyWithRoot("refresh-replay-race");
    const winner = await connect();
    const replay = await connect();
    const observer = await connect();
    try {
      const winnerPid = (await winner.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
        .rows[0]!.pid;
      const replayPid = (await replay.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
        .rows[0]!.pid;
      await winner.query("BEGIN");
      await winner.query("SELECT id FROM auth_refresh_families WHERE id = $1 FOR UPDATE", [
        familyId,
      ]);
      await replay.query("BEGIN");
      const replayLock = replay.query(
        "SELECT id FROM auth_refresh_families WHERE id = $1 FOR UPDATE",
        [familyId],
      );
      await waitUntilBlocked(observer, replayPid, winnerPid);

      await winner.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id = $1", [rootId]);
      const childId = await insertRefreshToken(winner, tenantId, familyId, rootId);
      await winner.query("COMMIT");
      await replayLock;
      const presented = await replay.query<{ already_used: boolean }>(
        "SELECT used_at IS NOT NULL AS already_used FROM auth_refresh_tokens WHERE id = $1",
        [rootId],
      );
      expect(presented.rows[0]?.already_used).toBe(true);
      await replay.query(
        `UPDATE auth_refresh_families
         SET revoked_at = now(), revocation_reason = 'reuse_detected'
         WHERE id = $1 AND revoked_at IS NULL`,
        [familyId],
      );
      await replay.query("COMMIT");

      const outcome = await setup.query<{
        reason: string;
        child_retained: boolean;
        unused_children: string;
      }>(
        `SELECT family.revocation_reason AS reason,
                EXISTS(SELECT 1 FROM auth_refresh_tokens WHERE id = $2) AS child_retained,
                (SELECT count(*) FROM auth_refresh_tokens
                 WHERE family_id = family.id AND used_at IS NULL)::text AS unused_children
         FROM auth_refresh_families family WHERE family.id = $1`,
        [familyId, childId],
      );
      expect(outcome.rows[0]).toEqual({
        reason: "reuse_detected",
        child_retained: true,
        unused_children: "1",
      });
    } finally {
      await winner.query("ROLLBACK").catch(() => undefined);
      await replay.query("ROLLBACK").catch(() => undefined);
      await Promise.all([winner.end(), replay.end(), observer.end()]);
    }
  });

  it("prevents two concurrent unused children for one used parent", async () => {
    const [tenantId, familyId, rootId] = await familyWithRoot("two-child-race");
    await setup.query("UPDATE auth_refresh_tokens SET used_at = now() WHERE id = $1", [rootId]);
    const first = await connect();
    const second = await connect();
    try {
      const attempts = await Promise.allSettled([
        insertRefreshToken(first, tenantId, familyId, rootId),
        insertRefreshToken(second, tenantId, familyId, rootId),
      ]);
      expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
      const rejected = attempts.find(({ status }) => status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: {
          constraint: expect.stringMatching(
            /auth_refresh_tokens_one_(?:child_per_parent|current_family)_key/u,
          ),
        },
      });
      const count = await setup.query<{ unused: string; children: string }>(
        `SELECT count(*) FILTER (WHERE used_at IS NULL)::text AS unused,
                count(*) FILTER (WHERE parent_token_id = $2)::text AS children
         FROM auth_refresh_tokens WHERE family_id = $1`,
        [familyId, rootId],
      );
      expect(count.rows[0]).toEqual({ unused: "1", children: "1" });
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });
});
