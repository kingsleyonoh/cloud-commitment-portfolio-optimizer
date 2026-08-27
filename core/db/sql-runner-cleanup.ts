import type { Client } from "pg";

export async function finalizeSqlClient(
  client: Client,
  lockName: string | undefined,
  primaryFailure: unknown,
): Promise<void> {
  const cleanupFailures: Error[] = [];
  if (lockName)
    await captureCleanup(cleanupFailures, "release PostgreSQL advisory lock", async () => {
      const result = await client.query<{ unlocked: boolean }>(
        "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
        [lockName],
      );
      if (result.rows[0]?.unlocked !== true) {
        throw new Error("PostgreSQL reported that the advisory lock was not held.");
      }
    });
  await captureCleanup(cleanupFailures, "close PostgreSQL client", () => client.end());
  throwCleanupFailures(primaryFailure, cleanupFailures);
}

async function captureCleanup(
  failures: Error[],
  operation: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    failures.push(new Error(`Failed to ${operation}: ${errorMessage(error)}`, { cause: error }));
  }
}

function throwCleanupFailures(primaryFailure: unknown, cleanupFailures: Error[]): void {
  if (cleanupFailures.length === 0) return;
  if (primaryFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      "SQL plan failed and PostgreSQL cleanup also failed.",
      { cause: primaryFailure },
    );
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  throw new AggregateError(cleanupFailures, "Multiple PostgreSQL cleanup operations failed.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
