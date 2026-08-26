import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  canonicalStringify,
  loadAndValidateCorpus,
  validateCorpusBytes,
} from "../../scripts/economic-kernel-fixture-contract.mjs";
import { verifyCliBoundary } from "../../scripts/economic-kernel-cli-verifier.mjs";

const fixtureDirectory = "tests/fixtures/economic_kernel";

async function fixtureBytes() {
  return {
    casesBytes: await readFile(join(fixtureDirectory, "cases.v1.ndjson")),
    manifestBytes: await readFile(join(fixtureDirectory, "manifest.v1.json")),
  };
}

function replaceOnce(buffer, before, after) {
  const text = buffer.toString("utf8");
  assert.ok(text.includes(before), `fixture does not contain ${before}`);
  return Buffer.from(text.replace(before, after));
}

async function rejectsTamper(name, mutate, pattern) {
  await test(name, async () => {
    const bytes = await fixtureBytes();
    const tampered = mutate(bytes);
    assert.throws(() => validateCorpusBytes(tampered), pattern);
  });
}

test("corpus has five sorted deterministic cases with implemented expected values", async () => {
  const corpus = await loadAndValidateCorpus(fixtureDirectory);
  const ids = corpus.cases.map((fixtureCase) => fixtureCase.case_id);

  assert.equal(corpus.cases.length, 5);
  assert.deepEqual(ids, [...ids].sort());
  for (const fixtureCase of corpus.cases) {
    assert.equal(typeof fixtureCase.expected.net_savings_cents, "string");
    assert.equal(fixtureCase.oracle.status, "implemented");
    assert.equal(fixtureCase.operation, "evaluate");
  }
});

await rejectsTamper(
  "validator rejects noncanonical JSON",
  ({ casesBytes, manifestBytes }) => ({
    casesBytes,
    manifestBytes: Buffer.from(` ${manifestBytes}`),
  }),
  /canonical/u,
);
await rejectsTamper(
  "validator rejects duplicate or unsorted IDs",
  ({ casesBytes, manifestBytes }) => ({
    casesBytes: Buffer.concat([casesBytes, casesBytes.subarray(0, casesBytes.indexOf(10) + 1)]),
    manifestBytes,
  }),
  /sorted|duplicate|manifest/u,
);
await rejectsTamper(
  "validator rejects JSON floats",
  ({ casesBytes, manifestBytes }) => ({
    casesBytes: replaceOnce(casesBytes, '"term_months":"12"', '"term_months":12.5'),
    manifestBytes,
  }),
  /canonical|number|string/u,
);
await rejectsTamper(
  "validator rejects disallowed units",
  ({ casesBytes, manifestBytes }) => ({
    casesBytes: replaceOnce(casesBytes, '"term_months":"count"', '"term_months":"months"'),
    manifestBytes,
  }),
  /unit/u,
);
await rejectsTamper(
  "validator rejects fake expected values",
  ({ casesBytes, manifestBytes }) => ({
    casesBytes: replaceOnce(
      casesBytes,
      '"net_savings_cents":"40000"',
      '"net_savings_cents":"40001"',
    ),
    manifestBytes,
  }),
  /expected/u,
);
await rejectsTamper(
  "validator rejects placeholder ambiguity",
  ({ casesBytes, manifestBytes }) => ({
    casesBytes: replaceOnce(casesBytes, '"implemented"', '"placeholder"'),
    manifestBytes,
  }),
  /oracle|ambiguous/u,
);

test("canonical serializer sorts keys and escapes strings deterministically", () => {
  assert.equal(
    canonicalStringify({ z: 'line\n"', a: { b: "2", a: "1" } }),
    String.raw`{"a":{"a":"1","b":"2"},"z":"line\n\""}`,
  );
});

test("CLI verifier rejects wrong contract, exit status, and stderr", async () => {
  const directory = await mkdtemp(join(tmpdir(), "economic-kernel-cli-tamper-"));
  const fake = join(directory, "fake-cli.mjs");
  await writeFile(
    fake,
    'process.stderr.write("tampered\\n"); process.stdout.write("{}\\n"); process.exit(0);\n',
  );
  const corpus = await loadAndValidateCorpus(fixtureDirectory);

  assert.throws(
    () => verifyCliBoundary(corpus, { command: process.execPath, args: [fake] }),
    /contract|stderr|exit/u,
  );
  await rm(directory, { recursive: true, force: true });
});

test("fixtures command explicitly builds and validates the installed real CLI without rewrites", async () => {
  const before = await fixtureBytes();
  const command =
    process.platform === "win32"
      ? {
          executable: process.env.ComSpec ?? "cmd.exe",
          args: ["/d", "/s", "/c", "npm run fixtures:golden"],
        }
      : { executable: "npm", args: ["run", "fixtures:golden"] };
  const result = spawnSync(command.executable, command.args, { encoding: "utf8" });
  const after = await fixtureBytes();

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(after, before);
  assert.match(result.stdout, /zig build -Doptimize=ReleaseSafe/u);
  assert.match(result.stdout, /validated 5 implemented economic-kernel fixtures/u);
});
