import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { expect, it } from "vitest";

const requiredScripts = {
  dev: "tsx watch --env-file-if-exists=.env.local apps/api/server.ts",
  "worker:dev": "tsx --env-file-if-exists=.env.local apps/worker/server.ts",
  lint: "eslint apps core scripts tests *.config.ts",
  format:
    'prettier --write "apps/**/*.ts" "core/**/*.ts" "scripts/**/*.{ts,mjs}" "tests/**/*.{ts,mjs}" "*.config.ts" "eslint.config.js" "prettier.config.mjs" "package.json" "tsconfig*.json"',
  "format:check":
    'prettier --check "apps/**/*.ts" "core/**/*.ts" "scripts/**/*.{ts,mjs}" "tests/**/*.{ts,mjs}" "*.config.ts" "eslint.config.js" "prettier.config.mjs" "package.json" "tsconfig*.json"',
  "build:clean": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
  build: "npm run build:clean && tsc -p tsconfig.build.json",
};

const lintDependencies = ["eslint", "@eslint/js", "typescript-eslint", "globals", "prettier"];
const deferredDependencies = [
  "htmx.org",
  "@fastify/static",
  "@fastify/view",
  "vite",
  "tailwindcss",
  "bullmq",
  "ioredis",
];

it("exposes real source, analysis, formatting, and clean production build scripts", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  expect(packageJson.scripts).toMatchObject(requiredScripts);
});

it("declares only the justified lint and formatting development dependencies", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  for (const dependency of lintDependencies) {
    expect(packageJson.devDependencies[dependency]).toBeTypeOf("string");
  }
  for (const dependency of deferredDependencies) {
    expect(packageJson.dependencies[dependency]).toBeUndefined();
    expect(packageJson.devDependencies[dependency]).toBeUndefined();
  }
});

it("pins the exact registration limiter dependencies without a competing rate plugin", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };

  expect(packageJson.dependencies.redis).toBe("6.1.0");
  expect(packageJson.dependencies["ipaddr.js"]).toBe("2.4.0");
  expect(packageJson.dependencies["@fastify/rate-limit"]).toBeUndefined();
});

it("pins one Fastify-compatible JWT integration and no competing direct JWT library", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };

  expect(packageJson.dependencies["@fastify/jwt"]).toBe("10.2.0");
  for (const competing of ["fast-jwt", "jose", "jsonwebtoken"]) {
    expect(packageJson.dependencies[competing]).toBeUndefined();
  }
});

it("emits only runtime TypeScript modules to Docker's exact server path", async () => {
  const [configText, dockerfile] = await Promise.all([
    readFile("tsconfig.build.json", "utf8"),
    readFile("Dockerfile", "utf8"),
  ]);
  const config = JSON.parse(configText) as {
    compilerOptions: Record<string, unknown>;
    include: string[];
    exclude: string[];
  };

  expect(config.compilerOptions).toMatchObject({
    noEmit: false,
    noEmitOnError: true,
    rootDir: ".",
    outDir: "dist",
    sourceMap: false,
    declaration: false,
  });
  expect(config.include).toEqual(["apps/**/*.ts", "core/**/*.ts", "types/**/*.d.ts"]);
  expect(config.exclude).toEqual(
    expect.arrayContaining(["tests", "scripts", "node_modules", "dist"]),
  );
  expect(dockerfile).toContain('CMD ["node", "dist/apps/api/server.js"]');
});

it("creates the exact built executable without emitting tests or config", async () => {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const arguments_ =
    process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
  const result = spawnSync(command, arguments_, { encoding: "utf8" });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  await expect(stat("dist/apps/api/server.js")).resolves.toBeDefined();
  await expect(stat("dist/apps/worker/server.js")).resolves.toBeDefined();
  await expect(stat("dist/tests")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat("dist/scripts")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat("dist/playwright.config.js")).rejects.toMatchObject({ code: "ENOENT" });
}, 60_000);
