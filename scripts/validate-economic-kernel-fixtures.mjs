#!/usr/bin/env node
import { existsSync } from "node:fs";

import { verifyCliBoundary } from "./economic-kernel-cli-verifier.mjs";
import { loadAndValidateCorpus } from "./economic-kernel-fixture-contract.mjs";

const fixtureDirectory = "tests/fixtures/economic_kernel";
const executable =
  process.platform === "win32"
    ? "zig-out/bin/cloud-commitment-optimizer.exe"
    : "zig-out/bin/cloud-commitment-optimizer";

function fail(message) {
  process.stderr.write(`economic-kernel fixture validation failed: ${message}\n`);
  process.exit(1);
}

if (!existsSync(executable)) {
  fail(`${executable} was not installed; run the explicit fixtures:golden build command`);
}

try {
  const corpus = await loadAndValidateCorpus(fixtureDirectory);
  verifyCliBoundary(corpus, { command: executable });
  process.stdout.write(`validated ${corpus.cases.length} deferred economic-kernel fixtures\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
