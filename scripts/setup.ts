import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigFromEnv } from "../core/shared/config.js";
import { ensureLocalWorkspace } from "../core/shared/local-workspace.js";
import { runMigrations } from "./db-migrate.js";

async function discoverSeedFiles(seedsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(seedsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(sql|ts|js)$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function runSetup(): Promise<void> {
  const config = loadConfigFromEnv();
  await ensureLocalWorkspace({
    duckdbTempDir: config.storage.duckdbTempDir,
    objectStoragePath: config.storage.objectStoragePath,
    reportStoragePath: config.storage.reportStoragePath,
  });

  const appliedMigrations = await runMigrations();
  const seedFiles = await discoverSeedFiles("db/seeds");

  console.log("CCPO first-run workspace ready.");
  console.log(`Migrations applied: ${appliedMigrations}`);
  console.log(`Seed files discovered: ${seedFiles.length}`);
  if (seedFiles.length === 0) {
    console.log(
      "Tenant seed implementation begins with the tenant schema batch.",
    );
  }
}

function isDirectRun(): boolean {
  return resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  runSetup().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
