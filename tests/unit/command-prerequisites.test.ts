import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { requireDatabaseUrl } from "../../core/db/connection.js";
import { databaseCommandPaths } from "../../scripts/db-command-options.js";

describe("database command prerequisites", () => {
  it("requires an explicit PostgreSQL URL instead of guessing a database", () => {
    expect(() => requireDatabaseUrl({})).toThrow(/DATABASE_URL is required/iu);
  });

  it("rejects non-PostgreSQL connection URLs", () => {
    expect(() => requireDatabaseUrl({ DATABASE_URL: "redis://localhost:6379" })).toThrow(
      /postgresql URL/iu,
    );
  });

  it("accepts PostgreSQL URLs without exposing credentials in output", () => {
    expect(
      requireDatabaseUrl({ DATABASE_URL: "postgresql://user:placeholder@example.test:5432/ccpo" }),
    ).toBe("postgresql://user:placeholder@example.test:5432/ccpo");
  });

  it("keeps typed setup migration-only and rejects the retired SQL seed option", () => {
    const paths = databaseCommandPaths(["--migrations-dir", "db/migrations"]);

    expect(paths.migrationsDirectory).toMatch(/db[\\/]migrations$/u);
    expect("seedsDirectory" in paths).toBe(false);
    expect(() => databaseCommandPaths(["--seeds-dir", "db/seeds"])).toThrow(/unknown option/iu);
  });

  it("keeps setup, unit, Zig, integration, and E2E in the aggregate gate", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const aggregate = packageJson.scripts["test:all"] ?? "";

    expect(aggregate).toContain("npm run test:setup");
    expect(aggregate).toContain("npm run test");
    expect(aggregate).toContain("zig build test");
    expect(aggregate).toContain("npm run test:integration");
    expect(aggregate).toContain("npm run test:e2e");
    expect(packageJson.scripts.setup).toContain("--env-file-if-exists=.env.local");
  });
});
