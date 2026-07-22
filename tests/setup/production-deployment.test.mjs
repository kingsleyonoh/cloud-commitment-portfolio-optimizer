import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const composePath = "docker-compose.prod.yml";
const requiredProductionEnvironment = {
  POSTGRES_PASSWORD: "placeholder",
  APP_PUBLIC_URL: "https://optimizer.example.test",
  ALLOWED_ORIGINS: "https://optimizer.example.test",
  DEPLOYMENT_REGION: "eu-test-1",
  DATABASE_REGION: "eu-test-1",
  DATABASE_URL: "postgresql://db.internal:5432/ccpo",
  DB_POOL_MAX: "20",
  DB_POOL_IDLE_TIMEOUT_MS: "30000",
  DB_POOL_CONNECTION_TIMEOUT_MS: "5000",
  JWT_ISSUER: "ccpo",
  JWT_AUDIENCE: "ccpo-ui",
  JWT_PRIVATE_KEY_PATH: "/run/config-source/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "/run/config-source/jwt-public.pem",
};

function composeConfig(environment = requiredProductionEnvironment) {
  return spawnSync("docker", ["compose", "-f", composePath, "config", "--format", "json"], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

test("all Compose interpolation names are declared in the environment example", async () => {
  const [example, localCompose, productionCompose] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("docker-compose.yml", "utf8"),
    readFile(composePath, "utf8"),
  ]);
  const declared = new Set(
    example
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 1)[0]),
  );
  const references = new Set(
    Array.from(
      `${localCompose}\n${productionCompose}`.matchAll(/\$\{([A-Z][A-Z0-9_]*)[^}]*\}/gu),
      (match) => match[1],
    ),
  );

  for (const key of references) assert.ok(declared.has(key), `${key} is undocumented`);
  for (const key of ["POSTGRES_PASSWORD", "APP_PUBLIC_URL"]) {
    assert.ok(references.has(key), `${key} is not consumed by production Compose`);
  }
});

test("production Compose fails interpolation for every required deployment input", () => {
  for (const key of Object.keys(requiredProductionEnvironment)) {
    const environment = { ...requiredProductionEnvironment, [key]: "" };
    const result = composeConfig(environment);
    assert.notEqual(result.status, 0, `${key} unexpectedly accepted an empty value`);
    assert.match(result.stderr, new RegExp(key));
  }
});

test("production dependencies are internal, persistent, healthy, restartable, and bounded", () => {
  const result = composeConfig();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(result.stdout);

  assert.equal(config.services.postgres.ports, undefined);
  assert.equal(config.services.redis.ports, undefined);
  assert.ok(config.services.postgres.healthcheck);
  assert.ok(config.services.redis.healthcheck);
  assert.equal(config.services.postgres.restart, "unless-stopped");
  assert.equal(config.services.redis.restart, "unless-stopped");
  assert.equal(config.services.app.restart, "unless-stopped");
  assert.ok(config.services.redis.volumes.some((volume) => volume.target === "/data"));
  assert.ok(config.volumes.redis_data);

  for (const serviceName of ["postgres", "redis", "app"]) {
    const limits = config.services[serviceName].deploy?.resources?.limits;
    assert.ok(limits?.cpus, `${serviceName} CPU limit missing`);
    assert.ok(limits?.memory, `${serviceName} memory limit missing`);
    assert.ok(limits?.pids > 0, `${serviceName} PID limit missing`);
  }
});

test("production app config uses explicit public URL and typed pool interpolation", () => {
  const result = composeConfig();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(result.stdout);
  const environment = config.services.app.environment;

  assert.equal(environment.PUBLIC_BASE_URL, requiredProductionEnvironment.APP_PUBLIC_URL);
  assert.notEqual(new URL(environment.PUBLIC_BASE_URL).hostname, "localhost");
  assert.equal(environment.DB_POOL_MAX, requiredProductionEnvironment.DB_POOL_MAX);
  assert.equal(
    environment.DB_POOL_IDLE_TIMEOUT_MS,
    requiredProductionEnvironment.DB_POOL_IDLE_TIMEOUT_MS,
  );
  assert.equal(
    environment.DB_POOL_CONNECTION_TIMEOUT_MS,
    requiredProductionEnvironment.DB_POOL_CONNECTION_TIMEOUT_MS,
  );
  assert.equal(environment.JWT_ISSUER, requiredProductionEnvironment.JWT_ISSUER);
  assert.equal(environment.JWT_AUDIENCE, requiredProductionEnvironment.JWT_AUDIENCE);
  assert.equal(environment.JWT_PRIVATE_KEY_PATH, "/run/config/jwt-private.pem");
  assert.equal(environment.JWT_PUBLIC_KEY_PATH, "/run/config/jwt-public.pem");
  assert.equal(environment.AUTH_LIMITER_MODE, "redis");
  assert.equal(environment.AUTH_COOKIE_SECURE, "true");
  for (const [source, target] of [
    [requiredProductionEnvironment.JWT_PRIVATE_KEY_PATH, "/run/config/jwt-private.pem"],
    [requiredProductionEnvironment.JWT_PUBLIC_KEY_PATH, "/run/config/jwt-public.pem"],
  ]) {
    assert.ok(
      config.services.app.volumes.some(
        (volume) =>
          volume.source === source && volume.target === target && volume.read_only === true,
      ),
    );
  }
  assert.equal(
    config.services.postgres.environment.POSTGRES_PASSWORD,
    requiredProductionEnvironment.POSTGRES_PASSWORD,
  );
});

test("Dockerfile and package scripts share the exact TypeScript application build boundary", async () => {
  const [dockerfile, packageText, buildConfigText, zigBuild] = await Promise.all([
    readFile("Dockerfile", "utf8"),
    readFile("package.json", "utf8"),
    readFile("tsconfig.build.json", "utf8"),
    readFile("build.zig", "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const buildConfig = JSON.parse(buildConfigText);

  assert.match(dockerfile, /^ARG ZIG_VERSION=0\.14\.1$/mu);
  assert.match(dockerfile, /zig-x86_64-linux-\$\{ZIG_VERSION\}\.tar\.xz/u);
  assert.match(
    dockerfile,
    /TypeScript build\/start and the Zig package artifact boundary are active/iu,
  );
  assert.match(dockerfile, /Deployment readiness remains deferred/iu);
  assert.match(dockerfile, /CMD \["node", "dist\/apps\/api\/server\.js"\]/u);
  assert.equal(packageJson.scripts.build, "npm run build:clean && tsc -p tsconfig.build.json");
  assert.equal(buildConfig.compilerOptions.outDir, "dist");
  assert.deepEqual(buildConfig.include, ["apps/**/*.ts", "core/**/*.ts", "types/**/*.d.ts"]);
  assert.match(zigBuild, /\.name = "cloud-commitment-optimizer"/u);
  assert.match(zigBuild, /installArtifact\(executable\)/u);
  assert.match(dockerfile, /RUN zig build -Doptimize=ReleaseSafe/u);
  assert.match(dockerfile, /COPY --from=build \/app\/zig-out \.\/zig-out/u);
});
