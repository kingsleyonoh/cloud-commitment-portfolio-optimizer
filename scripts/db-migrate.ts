import { requireDatabaseUrl } from "../core/db/connection.js";
import { runMigrations } from "../core/db/migrations.js";
import { databaseCommandPaths } from "./db-command-options.js";

async function main(): Promise<void> {
  const databaseUrl = requireDatabaseUrl(process.env);
  const { migrationsDirectory } = databaseCommandPaths(process.argv.slice(2));
  const result = await runMigrations({ databaseUrl, migrationsDirectory });

  console.log(
    `Migrations complete: ${result.applied.length} applied, ${result.skipped.length} unchanged.`,
  );
  for (const filename of result.applied) console.log(`applied ${filename}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
