import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const installedExecutable =
  process.platform === "win32"
    ? "zig-out/bin/cloud-commitment-optimizer.exe"
    : "zig-out/bin/cloud-commitment-optimizer";

test("fixture command makes the ReleaseSafe build explicit while validator only uses the installed artifact", async () => {
  const [packageText, validator] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("scripts/validate-economic-kernel-fixtures.mjs", "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(
    packageJson.scripts["fixtures:golden"],
    "zig build -Doptimize=ReleaseSafe && node scripts/validate-economic-kernel-fixtures.mjs",
  );
  assert.doesNotMatch(validator, /spawnSync\(["']zig["']/u);
  assert.match(validator, /verifyCliBoundary\(corpus, \{ command: executable \}\)/u);
  assert.match(
    validator,
    new RegExp(installedExecutable.replaceAll("\\", "\\\\").replaceAll("/", "\\/"), "u"),
  );
});

test("Docker Zig download is pinned to the official archive size and SHA-256 before extraction", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");

  assert.match(dockerfile, /^ARG ZIG_VERSION=0\.14\.1$/mu);
  assert.match(dockerfile, /^ENV ZIG_ARCHIVE_SIZE=49086504$/mu);
  assert.match(
    dockerfile,
    /^ENV ZIG_SHA256=24aeeec8af16c381934a6cd7d95c807a8cb2cf7df9fa40d359aa884195c4716c$/mu,
  );
  assert.doesNotMatch(dockerfile, /^ARG ZIG_(?:ARCHIVE_SIZE|SHA256)=/mu);
  assert.match(dockerfile, /test "\$\(wc -c < zig\.tar\.xz\)" -eq "\$ZIG_ARCHIVE_SIZE"/u);
  assert.match(dockerfile, /echo "\$ZIG_SHA256 {2}zig\.tar\.xz" \| sha256sum -c -/u);
  assert.ok(
    dockerfile.indexOf("sha256sum -c -") < dockerfile.indexOf("tar -xf zig.tar.xz"),
    "archive must be verified before extraction",
  );
});
