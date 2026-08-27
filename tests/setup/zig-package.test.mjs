import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const executable =
  process.platform === "win32"
    ? "zig-out/bin/cloud-commitment-optimizer.exe"
    : "zig-out/bin/cloud-commitment-optimizer";

function runCli(input) {
  return spawnSync(executable, [], { encoding: "utf8", input });
}

test("Zig package installs the versioned optimizer CLI at the Docker-compatible path", async () => {
  const [manifest, build, dockerfile] = await Promise.all([
    readFile("build.zig.zon", "utf8"),
    readFile("build.zig", "utf8"),
    readFile("Dockerfile", "utf8"),
  ]);

  assert.match(manifest, /\.name = \.cloud_commitment_optimizer/u);
  assert.match(manifest, /\.minimum_zig_version = "0\.14\.1"/u);
  assert.match(manifest, /\.dependencies = \.\{\}/u);
  assert.match(build, /cloud-commitment-optimizer/u);
  assert.match(build, /installArtifact/u);
  assert.match(dockerfile, /COPY --from=build \/app\/zig-out \.\/zig-out/u);

  const result = spawnSync("zig", ["build", "-Doptimize=ReleaseSafe"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(executable), `${executable} was not installed`);
});

test("CLI exposes contract and implemented economic evaluation", () => {
  const contract = runCli(
    '{"command":"contract","contract_version":"economic-kernel-cli/v1","payload":{},"request_id":"contract-smoke"}\n',
  );
  assert.equal(contract.status, 0, contract.stderr);
  assert.equal(contract.stderr, "");
  assert.deepEqual(JSON.parse(contract.stdout), {
    capabilities: ["contract", "validate", "evaluate"],
    contract_version: "economic-kernel-cli/v1",
    economics_status: "implemented",
    numeric_encoding: "canonical_decimal_strings",
    ok: true,
    package_version: "0.1.0",
    request_id: "contract-smoke",
  });
});

test("evaluate is stable, escaped, silent, and returns expected cents", async () => {
  const fixtureCase = JSON.parse(
    (await readFile("tests/fixtures/economic_kernel/cases.v1.ndjson", "utf8")).split("\n")[0],
  );
  const input = `${JSON.stringify({
    command: "evaluate",
    contract_version: "economic-kernel-cli/v1",
    payload: { case: fixtureCase },
    request_id: 'quote-"-safe',
  })}\n`;
  const first = runCli(input);
  const second = runCli(input);

  assert.equal(first.status, 0);
  assert.equal(first.stderr, "");
  assert.deepEqual(JSON.parse(first.stdout), {
    contract_version: "economic-kernel-cli/v1",
    evaluation: fixtureCase.expected,
    ok: true,
    request_id: 'quote-"-safe',
  });
  assert.equal(second.stdout, first.stdout);
});

test("unsupported commands return a stable nonzero contract error", () => {
  const result = runCli(
    '{"command":"forecast","contract_version":"economic-kernel-cli/v1","payload":{},"request_id":"bad-command"}\n',
  );

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    '{"contract_version":"economic-kernel-cli/v1","error":{"code":"INVALID_COMMAND","message":"Command is not supported by this CLI contract."},"ok":false,"request_id":null}\n',
  );
});

test("invalid input fails without panic, stderr, or echoing input", () => {
  const secretLikeInput =
    '{"command":"validate","contract_version":"economic-kernel-cli/v1","payload":{"token":"must-not-echo"},"request_id":"bad"}\n';
  const result = runCli(secretLikeInput);

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    '{"contract_version":"economic-kernel-cli/v1","error":{"code":"INVALID_REQUEST","message":"Request does not match the canonical CLI contract."},"ok":false,"request_id":null}\n',
  );
  assert.doesNotMatch(result.stdout, /must-not-echo/u);
});
