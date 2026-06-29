import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSqlMigrations } from "../../scripts/db-migrate";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ccpo-migrations-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("discoverSqlMigrations", () => {
  it("returns migration SQL files in lexical order", async () => {
    const root = await makeTempRoot();
    const migrationsDir = join(root, "db/migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(join(migrationsDir, "002_second.sql"), "select 2;");
    await writeFile(join(migrationsDir, "001_first.sql"), "select 1;");
    await writeFile(join(migrationsDir, "README.md"), "ignored");

    await expect(discoverSqlMigrations(migrationsDir)).resolves.toEqual([
      join(migrationsDir, "001_first.sql"),
      join(migrationsDir, "002_second.sql"),
    ]);
  });

  it("treats a missing migration directory as an empty first-run scaffold", async () => {
    const root = await makeTempRoot();
    await expect(
      discoverSqlMigrations(join(root, "db/migrations")),
    ).resolves.toEqual([]);
  });
});
