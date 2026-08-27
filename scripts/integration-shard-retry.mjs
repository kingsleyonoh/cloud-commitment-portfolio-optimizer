const WINDOWS_FAST_FAIL_STATUSES = new Set([-1_073_740_791, 3_221_226_505, 127]);

export function isRetryableWindowsFastFail(platform, status, output) {
  const explicitFailure = /Failed (?:Tests|Suites)|Test Files[^\n]*failed/iu.test(output);
  return platform === "win32" && WINDOWS_FAST_FAIL_STATUSES.has(status) && !explicitFailure;
}

export function recommendedShardCount(fileCount, maximum) {
  if (!Number.isInteger(fileCount) || fileCount < 1 || !Number.isInteger(maximum) || maximum < 1) {
    throw new Error("integration shard counts must be positive integers");
  }
  let shardCount = Math.min(fileCount, maximum);
  while ((shardCount - 1) * Math.ceil(fileCount / shardCount) >= fileCount) shardCount -= 1;
  return shardCount;
}
