import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { canonicalStringify } from "./economic-kernel-fixture-contract.mjs";

export function verifyCliBoundary(corpus, commandSpec) {
  const contractResult = run(commandSpec, request("contract", "fixture-contract", {}));
  const expected = {
    capabilities: ["contract", "validate", "evaluate"],
    contract_version: "economic-kernel-cli/v1",
    economics_status: "implemented",
    numeric_encoding: "canonical_decimal_strings",
    ok: true,
    package_version: "0.1.0",
    request_id: "fixture-contract",
  };
  expectProcess(contractResult, 0, `${canonicalStringify(expected)}\n`, "contract");
  for (const fixtureCase of corpus.cases) verifyCase(commandSpec, fixtureCase);
}

function verifyCase(commandSpec, fixtureCase) {
  const payload = { case: fixtureCase };
  const validateResult = run(commandSpec, request("validate", fixtureCase.case_id, payload));
  const expectedValidate = {
    contract_version: "economic-kernel-cli/v1",
    ok: true,
    request_id: fixtureCase.case_id,
    validation: { economics_computed: true, schema_valid: true },
  };
  expectProcess(validateResult, 0, `${canonicalStringify(expectedValidate)}\n`, "validate");
  verifyEvaluate(commandSpec, fixtureCase, payload);
}

function verifyEvaluate(commandSpec, fixtureCase, payload) {
  const evaluateRequest = request("evaluate", fixtureCase.case_id, payload);
  const first = run(commandSpec, evaluateRequest);
  const second = run(commandSpec, evaluateRequest);
  const expected = {
    contract_version: "economic-kernel-cli/v1",
    evaluation: fixtureCase.expected,
    ok: true,
    request_id: fixtureCase.case_id,
  };
  expectProcess(first, 0, `${canonicalStringify(expected)}\n`, "evaluate");
  assert.deepEqual(second, first, "evaluate must be byte-identical across runs");
}

function request(command, requestId, payload) {
  return `${canonicalStringify({
    command,
    contract_version: "economic-kernel-cli/v1",
    payload,
    request_id: requestId,
  })}\n`;
}

function run({ command, args = [] }, input) {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function expectProcess(result, status, stdout, label) {
  assert.equal(result.status, status, `${label} exit status mismatch`);
  assert.equal(result.stderr, "", `${label} stderr must be empty`);
  assert.equal(result.stdout, stdout, `${label} contract output mismatch`);
}
