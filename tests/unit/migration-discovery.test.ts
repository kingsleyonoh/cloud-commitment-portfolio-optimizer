import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { discoverSqlFiles, MigrationPlanError } from "../../core/db/sql-plan.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-migrations-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

it("orders validated migration files by numeric version and computes stable checksums", async () => {
  const directory = await temporaryDirectory();
  await writeFile(join(directory, "0010_second.sql"), "SELECT 2;\n");
  await writeFile(join(directory, "0002_first.sql"), "SELECT 1;\n");

  const first = await discoverSqlFiles(directory, "migration");
  const second = await discoverSqlFiles(directory, "migration");

  expect(first.map(({ version, name }) => ({ version, name }))).toEqual([
    { version: "0002", name: "first" },
    { version: "0010", name: "second" },
  ]);
  expect(first.map(({ checksum }) => checksum)).toEqual(second.map(({ checksum }) => checksum));
  expect(first.every(({ checksum }) => /^[a-f0-9]{64}$/u.test(checksum))).toBe(true);
});

it("rejects duplicate numeric versions before touching a database", async () => {
  const directory = await temporaryDirectory();
  await writeFile(join(directory, "0001_alpha.sql"), "SELECT 1;\n");
  await writeFile(join(directory, "0001_beta.sql"), "SELECT 2;\n");

  await expect(discoverSqlFiles(directory, "migration")).rejects.toThrow(
    /duplicate migration version 0001/iu,
  );
});

it("rejects malformed filenames and an empty plan with actionable errors", async () => {
  const malformedDirectory = await temporaryDirectory();
  await writeFile(join(malformedDirectory, "create_things.sql"), "SELECT 1;\n");
  const emptyDirectory = await temporaryDirectory();

  await expect(discoverSqlFiles(malformedDirectory, "migration")).rejects.toBeInstanceOf(
    MigrationPlanError,
  );
  await expect(discoverSqlFiles(malformedDirectory, "migration")).rejects.toThrow(
    /NNNN_description\.sql/iu,
  );
  await expect(discoverSqlFiles(emptyDirectory, "migration")).rejects.toThrow(
    /no migration files found/iu,
  );
});
