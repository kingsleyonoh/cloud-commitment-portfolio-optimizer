import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve("scripts/integration-shard-retry.mjs")).href;

it("retries only Windows process fast-fail statuses without test failures", async () => {
  const { isRetryableWindowsFastFail } = (await import(moduleUrl)) as {
    isRetryableWindowsFastFail(platform: string, status: number | null, output: string): boolean;
  };

  expect(isRetryableWindowsFastFail("win32", 3_221_226_505, "")).toBe(true);
  expect(isRetryableWindowsFastFail("win32", -1_073_740_791, "")).toBe(true);
  expect(isRetryableWindowsFastFail("win32", 127, "")).toBe(true);
  expect(isRetryableWindowsFastFail("win32", 1, "Test Files 1 failed")).toBe(false);
  expect(isRetryableWindowsFastFail("linux", 3_221_226_505, "")).toBe(false);
});

it("bounds chunked Vitest shards so the final shard owns a test file", async () => {
  const { recommendedShardCount } = (await import(moduleUrl)) as {
    recommendedShardCount(fileCount: number, maximum: number): number;
  };

  expect(recommendedShardCount(102, 16)).toBe(15);
  expect(recommendedShardCount(16, 16)).toBe(16);
  expect(recommendedShardCount(1, 16)).toBe(1);
});
