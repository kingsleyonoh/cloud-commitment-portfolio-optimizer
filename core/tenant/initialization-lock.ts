import type { Client, PoolClient } from "pg";

export const INITIALIZATION_LOCK_KEY = "ccpo:first-run-initialization:v1";

export async function lockInitialization(client: Client | PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    INITIALIZATION_LOCK_KEY,
  ]);
}
