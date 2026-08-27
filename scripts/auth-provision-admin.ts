import { parseEnvironment } from "../core/config/env.js";
import { requireDatabaseUrl } from "../core/db/connection.js";
import { AdminProvisioningError, provisionFirstAdmin } from "../core/tenant/admin-provisioning.js";

interface CommandArguments {
  tenantId: string;
  email: string;
  name: string;
  passwordFile: string;
}

const OPTION_NAMES = new Map<string, keyof CommandArguments>([
  ["--tenant-id", "tenantId"],
  ["--email", "email"],
  ["--name", "name"],
  ["--password-file", "passwordFile"],
]);

export function parseAdminProvisionArguments(arguments_: readonly string[]): CommandArguments {
  const parsed: Partial<CommandArguments> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    const key = option ? OPTION_NAMES.get(option) : undefined;
    if (!key || !value || value.startsWith("--") || parsed[key] !== undefined) {
      throw new AdminProvisioningError();
    }
    parsed[key] = value;
  }
  if (!parsed.tenantId || !parsed.email || !parsed.name || !parsed.passwordFile) {
    throw new AdminProvisioningError();
  }
  return parsed as CommandArguments;
}

async function run(): Promise<void> {
  const databaseUrl = requireDatabaseUrl(process.env);
  const config = parseEnvironment(process.env);
  const arguments_ = parseAdminProvisionArguments(process.argv.slice(2));
  await provisionFirstAdmin({
    databaseUrl,
    ...arguments_,
    argon: {
      concurrency: config.auth.argonConcurrency,
      queueLimit: config.auth.argonQueueLimit,
    },
  });
  process.stdout.write("Administrator credential provisioned.\n");
}

run().catch(() => {
  process.stderr.write("Administrator credential provisioning failed; no changes were made.\n");
  process.exitCode = 1;
});
