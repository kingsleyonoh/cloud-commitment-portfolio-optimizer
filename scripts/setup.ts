import { EnvironmentValidationError, parseEnvironment } from "../core/config/env.js";
import { DatabasePrerequisiteError, requireDatabaseUrl } from "../core/db/connection.js";
import { runSetup } from "../core/db/setup.js";
import { FirstRunInitializationError } from "../core/tenant/initialization.js";
import { databaseCommandPaths } from "./db-command-options.js";

export type LineWriter = (line: string) => void | Promise<void>;

export interface SetupCommandOptions {
  environment: Readonly<Record<string, string | undefined>>;
  arguments: readonly string[];
  stdout: LineWriter;
}

export async function runSetupCommand(options: SetupCommandOptions): Promise<void> {
  const databaseUrl = requireDatabaseUrl(options.environment);
  const config = parseEnvironment(options.environment);
  const { migrationsDirectory } = databaseCommandPaths(options.arguments);
  const result = await runSetup({
    databaseUrl,
    migrationsDirectory,
    tenant: {
      defaultTenantName: config.tenant.defaultTenantName,
      defaultAdminEmail: config.tenant.defaultAdminEmail,
      defaultAdminName: config.tenant.defaultAdminName,
      defaultAdminPasswordFile: config.tenant.defaultAdminPasswordFile,
      apiKeyPrefix: config.tenant.apiKeyPrefix,
    },
    argon: {
      concurrency: config.auth.argonConcurrency,
      queueLimit: config.auth.argonQueueLimit,
    },
  });

  await options.stdout(
    JSON.stringify({
      event: "migrations_complete",
      applied: result.migrations.applied.length,
      unchanged: result.migrations.skipped.length,
    }),
  );
  const initialization = result.initialization;
  await options.stdout(
    JSON.stringify(
      initialization.created
        ? {
            event: "first_run_initialized",
            created: true,
            tenantId: initialization.tenantId,
            apiKeyId: initialization.apiKeyId,
            adminUserId: initialization.adminUserId,
            apiKey: initialization.apiKey,
          }
        : {
            event: "first_run_initialized",
            created: false,
            tenantId: initialization.tenantId,
            apiKeyId: initialization.apiKeyId,
            adminUserId: initialization.adminUserId,
          },
    ),
  );
}

function streamLine(stream: NodeJS.WriteStream): LineWriter {
  return (line) =>
    new Promise<void>((resolve, reject) => {
      stream.write(`${line}\n`, (error) => (error ? reject(error) : resolve()));
    });
}

export function safeSetupErrorMessage(error: unknown): string {
  if (
    error instanceof FirstRunInitializationError ||
    error instanceof EnvironmentValidationError ||
    error instanceof DatabasePrerequisiteError
  ) {
    return error.message;
  }
  return "First-run setup failed safely; no credential was issued by this process.";
}

runSetupCommand({
  environment: process.env,
  arguments: process.argv.slice(2),
  stdout: streamLine(process.stdout),
}).catch(async (error: unknown) => {
  await streamLine(process.stderr)(safeSetupErrorMessage(error));
  process.exitCode = 1;
});
