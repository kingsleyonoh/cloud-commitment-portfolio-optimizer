import { createArgonExecutor, type ArgonExecutorOptions } from "../tenant/argon-executor.js";
import {
  initializeFirstRun,
  prepareFirstRunInput,
  type FirstRunInitializationResult,
  type FirstRunTenantConfig,
  type PreparedFirstRunInput,
} from "../tenant/initialization.js";
import { runMigrations, type MigrationOptions } from "./migrations.js";
import type { SqlRunResult } from "./sql-runner.js";

export interface SetupOptions extends MigrationOptions {
  tenant: FirstRunTenantConfig;
  argon?: ArgonExecutorOptions;
}

export interface SetupResult {
  migrations: SqlRunResult;
  initialization: FirstRunInitializationResult;
}

export async function runSetup(options: SetupOptions): Promise<SetupResult> {
  const executor = createArgonExecutor(options.argon ?? { concurrency: 2, queueLimit: 32 });
  let input: PreparedFirstRunInput;
  try {
    input = await prepareFirstRunInput(options.tenant, executor);
  } finally {
    executor.close();
  }
  const migrations = await runMigrations(options);
  const initialization = await initializeFirstRun(options.databaseUrl, input);
  return { migrations, initialization };
}
