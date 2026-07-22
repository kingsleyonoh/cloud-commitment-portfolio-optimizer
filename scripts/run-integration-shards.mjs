import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { isRetryableWindowsFastFail, recommendedShardCount } from "./integration-shard-retry.mjs";

const testFileCount = readdirSync(resolve("tests/integration"), {
  recursive: true,
  withFileTypes: true,
}).filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts")).length;
const shardCount = recommendedShardCount(testFileCount, 16);
const maxAttempts = 3;
const vitestEntry = resolve("node_modules/vitest/vitest.mjs");

for (let shard = 1; shard <= shardCount; shard += 1) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`Running integration shard ${shard}/${shardCount} (attempt ${attempt})`);
    const result = spawnSync(
      process.execPath,
      [
        vitestEntry,
        "run",
        "--config",
        "vitest.integration.config.ts",
        `--shard=${shard}/${shardCount}`,
      ],
      { cwd: resolve("."), encoding: "utf8", env: process.env, stdio: ["inherit", "pipe", "pipe"] },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status === 0) break;
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const retryable = isRetryableWindowsFastFail(process.platform, result.status, output);
    console.error(`Integration shard ${shard} exited status=${result.status}.`);
    if (!retryable || attempt === maxAttempts) process.exit(1);
    console.error(`Windows fast-fail interrupted shard ${shard}; retrying in a fresh process.`);
  }
}
