import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const composePath = "docker-compose.yml";

function composeConfig(environment = {}) {
  const result = spawnSync("docker", ["compose", "-f", composePath, "config", "--format", "json"], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });

  assert.equal(
    result.status,
    0,
    `docker compose config failed:\n${result.stderr || result.stdout}`,
  );
  return JSON.parse(result.stdout);
}

test("local Compose provides PostgreSQL 16 and Redis 7 with health checks", () => {
  const config = composeConfig();

  assert.match(config.services.postgres.image, /^postgres:16(?:-|$)/);
  assert.match(config.services.redis.image, /^redis:7(?:-|$)/);
  assert.ok(config.services.postgres.healthcheck);
  assert.ok(config.services.redis.healthcheck);
});

test("local database and cache ports bind to loopback only", () => {
  const config = composeConfig();

  for (const serviceName of ["postgres", "redis"]) {
    const ports = config.services[serviceName].ports;
    assert.equal(ports.length, 1);
    assert.equal(ports[0].host_ip, "127.0.0.1");
  }
});

test("local service host ports can be overridden without editing Compose", () => {
  const config = composeConfig({ POSTGRES_PORT: "55432", REDIS_PORT: "56379" });

  assert.equal(config.services.postgres.ports[0].published, "55432");
  assert.equal(config.services.redis.ports[0].published, "56379");
});

test("canonical local DuckDB and object-storage directories are present", () => {
  assert.equal(existsSync(".tmp/duckdb/.gitkeep"), true);
  assert.equal(existsSync(".data/objects/.gitkeep"), true);
});
