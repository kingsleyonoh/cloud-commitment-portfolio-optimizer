import { discoverSqlFiles } from "./sql-plan.js";
import { runSqlPlan, type SqlRunResult } from "./sql-runner.js";

export interface MigrationOptions {
  databaseUrl: string;
  migrationsDirectory: string;
}

export async function runMigrations(options: MigrationOptions): Promise<SqlRunResult> {
  const files = await discoverSqlFiles(options.migrationsDirectory, "migration");
  return runSqlPlan(options.databaseUrl, "migration", files);
}
