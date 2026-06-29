import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLocalWorkspace } from "../../core/shared/local-workspace";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ccpo-workspace-"));
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

describe("ensureLocalWorkspace", () => {
  it("creates DuckDB temp, object storage, and report directories from config", async () => {
    const root = await makeTempRoot();
    const result = await ensureLocalWorkspace({
      root,
      duckdbTempDir: ".tmp/duckdb",
      objectStoragePath: ".data/objects",
      reportStoragePath: ".data/reports",
    });

    expect(result.created.sort()).toEqual(
      [
        join(root, ".data/objects"),
        join(root, ".data/reports"),
        join(root, ".tmp/duckdb"),
      ].sort(),
    );
  });

  it("fails clearly when a configured directory path is occupied by a file", async () => {
    const root = await makeTempRoot();
    await writeFile(join(root, ".tmp"), "not a directory");

    await expect(
      ensureLocalWorkspace({
        root,
        duckdbTempDir: ".tmp/duckdb",
        objectStoragePath: ".data/objects",
        reportStoragePath: ".data/reports",
      }),
    ).rejects.toThrow(/local workspace path is not a directory/);
  });
});
