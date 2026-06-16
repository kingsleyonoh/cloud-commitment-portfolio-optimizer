# Klevar YOLO Runtime on Pi

The Klevar YOLO Runtime is the Pi SDK execution layer for template YOLO mode. It keeps the existing markdown prompts as policy/source material, but moves orchestration and verification into code.

## Easiest Usage

### Inside Pi

```text
/yolo-dry
/klevar-yolo dry-run next 1
/klevar-yolo next 1
/klevar-yolo phase 1
/klevar-yolo parallel next 2
/klevar-yolo continue
/yolo-replay batch-001-implement
/yolo-status
/yolo-dashboard
/yolo-watch
/yolo-hide
```

The Pi extension auto-installs runtime dependencies with `npm ci` and builds the runtime if `dist/cli.js` is missing.

### PowerShell

```powershell
.\scripts\klevar-yolo.ps1 dry-run next 1
.\scripts\klevar-yolo.ps1 next 1
.\scripts\klevar-yolo.ps1 phase 1
```

### Bash / Git Bash / WSL

```bash
bash scripts/klevar-yolo.sh dry-run next 1
bash scripts/klevar-yolo.sh next 1
bash scripts/klevar-yolo.sh phase 1
```

The wrapper scripts auto-run `npm ci` and `npm run build` on first use.

## Direct Runtime Command

```bash
cd tools/klevar-yolo-runtime
npm ci
npm run build
cd ../..
node tools/klevar-yolo-runtime/dist/cli.js dry-run next 1
node tools/klevar-yolo-runtime/dist/cli.js next 1
node tools/klevar-yolo-runtime/dist/cli.js replay batch-001-implement
node tools/klevar-yolo-runtime/dist/cli.js incident-replay .yolo/incidents/example
node tools/klevar-yolo-runtime/dist/cli.js acceptance-gate
```

## Release / Stabilization Acceptance Gate

Before refreshing package/runtime code into live projects or continuing a fleet after runtime changes, run the fail-closed acceptance gate from the template root:

```bash
cd tools/klevar-yolo-runtime
npm ci
npm run build
cd ../..
node tools/klevar-yolo-runtime/dist/cli.js acceptance-gate
```

The gate runs, in order: runtime `npm test`, Pi package `npm test`, every deterministic fixture under `tools/klevar-yolo-runtime/test-fixtures/incidents/`, and a runtime `dry-run next 1` sandbox smoke. Use `--skip-sandbox` only when the local sandbox dry-run is not feasible; the output records the skip explicitly. Any missing directory, missing incident fixture, failed command, or failed replay exits non-zero and prints `FAIL release/stabilization gate` plus `Release gate failed closed` so operators do not continue live projects on partial evidence.

## Guarantees

The runtime is designed to enforce:

1. Fresh Pi `AgentSession` per sub-agent.
2. No master conversation carry-over into sub-agents.
3. Worktree isolation for writable implementation batches.
4. Dual output: human markdown + machine JSON.
5. Runtime-owned validation for result contract, TDD, E2E, wiring, path policy, secrets, command re-runs for GREEN/REGRESSION/E2E evidence, active project-local checks, business-logic evidence, and duplicate artifact detection.
6. Separate validation sub-agent after machine gates, with validator JSON verdict enforcement.
7. Dedicated audit dispatch for `[AUDIT]` batches and journal sub-agent dispatch for build-journal/gate evidence.
8. Recovery dispatch for canonical open findings even when individual runtime gates pass, so success-with-blocking-flags such as missing E2E setup routes to bugfix before commit. Canonical batch state rebuilds active blockers from the latest trusted result/gate evidence: newer successful bugfix artifacts with source changes or runtime-only recovery artifacts backed by passing runnable commands quarantine stale runtime/support/tooling findings, while product/source blockers stay open unless matching semantic recovery evidence closes them. Audit/live-E2E evidence findings are stricter: `COVERAGE_GAP`, audit, and live E2E blockers close only with exact positive closure evidence for that finding id; skipped/non-runnable live E2E or generic green validation leaves them open. `closureTraces` and `openExplanations` show whether findings closed by semantic source evidence, artifact-command evidence, gate reconciliation, state hygiene quarantine, exact audit/live closure evidence, or stayed open because accepted evidence was missing.
9. Runtime-owned control-plane paths stay out of recovered changed-file manifests and final sync. Late final-sync declaration checks also ignore non-material Git status noise such as CRLF-only/worktree-normalization entries instead of treating them as undeclared product edits. `src/path-policy.ts` now exposes a path classifier with owner/sync/deliverable dispositions so validators, recovery merge, and worktree sync share the same taxonomy.
10. A merge-readiness gate runs before journal/closeout to catch undeclared material worktree changes, root dirty conflicts, and runtime path leakage before expensive late-phase work reaches final sync.
11. Runtime speed telemetry records validator durations, skipped expensive gates, and command cache/adoption decisions so faster runs stay explainable.
12. In `balanced`/`fast` validation modes, cheap structural/safety/evidence gates run before expensive command reruns, wiring inference, frontend detection, and product-quality checks; if cheap blockers fail, expensive gates are marked skipped and the batch remains blocked instead of wasting time on known-bad input. `safe` mode still runs the full validator set for complete diagnostics.
13. Runtime self-healing is enabled for bounded operational failures: unreadable runtime state is archived before resume rewrites it, journal contract failures get one telemetry-visible retry, cleanup/tooling transients are recorded as self-healed skips, and state hygiene prevents repeated bugfix/support artifacts from compounding stale runtime-owned blockers after trusted recovery evidence exists. Runtime/tooling/support recovery signatures are runtime-owned routing decisions, not product defects: `PLAN_REJECTED`, stale `.yolo`/`.pi`/`.agent` artifacts, protected coordination-file modularity/sync-context findings, result/contract/gate/journal/worktree failures, and unsafe/protected/blocked paths stop before bugfix dispatch and surface runtime/tooling/human intervention. Sub-agent prompts have a prompt-size preflight (`maxPromptChars`, default 180k); bugfix recovery first compacts over-budget recovery context into a fresh narrow blocker-signature prompt, writes a `.yolo/subagent-runs/<id>-context-budget.json` artifact, and dispatches that recovery instead of appending raw logs until context overflow. `AGENT_CONTEXT_BUDGET_EXCEEDED` remains a final safety backstop if even the compacted prompt is over budget, so the runtime fails cleanly rather than producing an invalid context-overflow result. Product/business/source blockers can still use the existing bugfix recovery path. If runtime-owned state is already poisoned, the terminal runtime state uses `RUNTIME_POISONED_RECOVERY_LOOP` as the primary event and tells operators to preserve the incident fixture, clean the failed batch, and restart after the runtime/tooling fix instead of ordinary `/klevar-yolo continue` or another bugfix. Safety/human blockers such as secrets, external mutations, protected paths, protected coordination-file modularity/sync-context findings, auth/tenant/payment/security issues, merge conflicts, schema migrations, and unknown repeated failures do not self-heal or dispatch bugfix recovery.
14. Deterministic journal fast path can replace the journal subagent for simple validated low/medium-risk implementation batches after merge-readiness passes, writing `docs/build-journal/<NNN>-batch.md` and `.yolo/gates/journal-batch-<NNN>.md` through the existing journal contract. Audits, closeouts, support batches, high/critical-risk work, open findings, and contract failures fall back to the journal agent.
15. Observe-only speed telemetry records risk classification and affected-test candidates after results are known, without changing batch selection, validation policy, gates, retries, command evidence, or closeout.
16. Deterministic incident replay fixtures can exercise recovery-merge, worktree-sync, and runtime-classification failures without live agents via `cli.js incident-replay <fixture-dir>`, where `scenario.json` declares the incident kind and expected outcome. The checked-in suite under `tools/klevar-yolo-runtime/src/__fixtures__/incidents/` packages redacted/minimal reproductions for Billbee B056 protected-path/stale metadata, Billbee B065 PLAN_REJECTED support loop, Commercial B016 poisoned stale recovery, Field Service undeclared changed files, and Trade Compliance runtime-only path leakage. Each fixture asserts classification, active blockers, quarantined stale runtime findings, recommendation text, and whether bugfix dispatch is allowed, so runtime-owned incidents stop without spending product bugfix attempts while real product blockers remain open. When a batch exits rejected after runtime/support recovery is exhausted, the runtime also captures a minimal poisoned-exit fixture under the gitignored local-only `.yolo/incidents/batch-<NNN>-<timestamp>-poisoned-exit/` containing a manifest plus flattened copies of runtime state, recent runtime logs, matching batch result artifacts, matching gate files, and `git status --short` for the recorded worktree when available. Captured evidence filenames are flattened so copied worktree artifacts never create nested `.yolo/worktrees/` path shapes inside the fixture. Capturing a fixture is evidence preservation only; poisoned runtime loops remain runtime/tooling incidents and should not be reclassified as product recoverable defects.
17. Runtime-owned commits, progress ticking, closeout gates, and inbox reconciliation.
18. Failure-pattern tracking in `.yolo/failure-patterns.json` with reinforcement dispatch after the configured recurrence threshold.
19. Replayable prompts, manifests, sessions, and journal entries under `.yolo/`.
20. Explicit local parallel mode for independent shards, with claim/file-conflict checks before merge.
21. Runtime version/refresh proof is written to `.yolo/runtime-state.json` as `runtimeMetadata` and to `.yolo/events/batch-NNN.jsonl` as `runtime_version_proof`. The proof includes the YOLO runtime package version, state hygiene revision, template/runtime sync timestamp when `.klevar/project.json` or `.last-sync` exposes one, runtime source mtime proof, and Pi package version/source proof when the package is available. Pi dashboard and `/yolo-explain` render the same fields so operators can verify they are looking at refreshed runtime state instead of stale vendored code.
22. Optional Telegram failure notifications via local environment variables; secrets are never stored in project files.

## Model Routing Defaults

The default runtime routes use stronger reasoning for judgment-heavy roles while keeping routine work lower-cost:

- `master`, `audit`, and `adjudicate`: `xhigh` for batch selection, phase closeout, coverage/scope honesty, and ambiguous gate decisions.
- `validate` and `bugfix`: `high` for evidence review and recovery.
- `implement` and `knowledge`: `medium` for the normal code/test/tool loop and knowledge updates.
- `journal` and `inbox`: `low` for mechanical summaries and low-cost routing.

Project-local `.yolo/runtime.config.json` overrides are honored, including intentional `high` and `xhigh` routes. Older generated project configs that still have `medium` for judgment roles are promoted at load time unless a route pins a custom `model`, so `/refresh` can pick up safer defaults without overwriting local model choices.

## Entrypoint Testing Guardrail

Batch selection remains progress-order/context preserving. The runtime does not shrink or reshuffle batches for speed because context-rich batches reduce downstream wiring issues. Entrypoint work (`[API]`, `[UI]`, `[JOB]`, `[INTEGRATION]`) still must provide runnable E2E/wiring evidence, and if a sub-agent returns `SUCCESS` with a canonical blocking flag such as `e2e_setup_missing:true`, the runtime dispatches bugfix recovery instead of committing or stopping immediately.

## Accuracy-First Speed Roadmap

The runtime should improve development speed without trading away correctness. The rule is: **reuse only runtime-owned evidence, never agent claims, and invalidate on any relevant worktree change.**

Implemented baseline:

1. **Runtime-owned command rerun cache and artifacts** — `.yolo/command-cache.json` stores successful GREEN/REGRESSION/E2E reruns keyed by exact command, phase, and deterministic non-`.yolo` worktree snapshot. Unchanged retries can reuse the pass; changed trees rerun normally. Failed reruns with large stdout/stderr write redacted artifacts under `.yolo/command-runs/batch-###/<phase>-<hash>/{stdout.txt,stderr.txt,summary.json}`; gate flags stay compact and cite the summary artifact instead of embedding raw logs.
2. **Cache/adoption telemetry visibility** — `.yolo/runtime-state.json` and `.yolo/events/batch-###.jsonl` record command reuse decisions (`hit`, `miss`, `adopted`, `recorded`) and validator timing/provenance so dashboard/explain surfaces can show why work was skipped or reused.
3. **Cheap-gates-before-expensive-gates** — `validateAllWithState(...)` evaluates progress/contract/TDD/E2E/path/local-only/external-ops/secrets/project-local/business/artifact gates before expensive wiring inference, command reruns, frontend detector, and product-quality gates. In `balanced`/`fast`, hard cheap blockers skip the expensive set with explicit `SKIPPED_EXPENSIVE_GATE_DUE_TO_CHEAP_BLOCKERS` flags; `safe` mode preserves complete diagnostics.
4. **Runtime Self-Healing v1** — operational failures recover automatically only when deterministic and bounded: unreadable `.yolo/runtime-state.json` is archived under `.yolo/recovery/`, journal failures retry once through the existing journal agent path, and cleanup/tooling transients are logged as non-fatal self-healed cleanup skips. `.yolo/runtime-state.json` and `.yolo/events/batch-###.jsonl` record every self-heal attempt.
5. **Deterministic journal fast path** — simple validated implementation batches can write build-journal/gate artifacts without spawning the journal subagent. The generated result is validated by `validateJournalContract()` and falls back to the journal agent when ineligible or invalid.
6. **Observe-only risk and affected-test telemetry** — runtime records observed risk and candidate affected-test commands for later analysis. These observations do not influence batch selection, validation policy, command reruns, gates, retries, or closeout.

Planned follow-ups, in safe order:

1. **Risk-classified rerun policy** — use observed risk only after fleet telemetry proves it is safe. Schema, migration, auth, tenant/security, shared foundation, test setup, build config, and dependency changes still force full regression. Narrow leaf changes can run targeted + affected tests first.
2. **Affected-test discovery enforcement** — derive candidate tests from changed source paths, imports, route/CLI/job wiring, and explicit `verifiedBy` evidence. This supplements, not replaces, mandatory gates.
4. **Full-regression cadence for long scopes** — for `full`/phase-range runs, require full regression at phase closeout, final support validation, and every configured N successful low-risk batches, while still forcing full regression on high-risk changes.
5. **Suite partitioning** — allow projects to declare named suites (`unit`, `integration`, `e2e`, `security`, `migration`) with risk triggers so runtime can run the smallest sufficient set before final/full checks.
6. **Failure-local retry** — when one suite fails, first rerun the failing test files with verbose output before rerunning the whole suite, preserving full evidence but reducing diagnosis time.
7. **Post-commit audit sampling** — after successful low-risk batches, optionally run slower broad checks asynchronously or at the next boundary, never marking a batch complete without the gates required by its risk class.

Non-negotiables:

- Do not accept sub-agent-reported passes without runtime-owned verification or a valid runtime cache hit.
- Do not skip full regression for migrations, shared auth/tenant/security surfaces, test setup, dependency/build tooling, public contract changes, or phase/final closeouts.
- Do not let speed policy hide failures; reused evidence, journal decisions, risk/affected-test observations, and self-heal attempts must be visible in telemetry and explain output.
- Do not change batch selection for speed. Context-rich batch selection remains a correctness requirement.
- Do not self-heal secrets, external mutations, human claim conflicts, protected/blocked paths, security/auth/tenant/payment/privacy issues, merge conflicts, schema migrations, commit/push failures, or unknown repeated exceptions.

## Telegram Failure Notifications

Set these environment variables on the machine running Pi/Klevar:

```powershell
[Environment]::SetEnvironmentVariable("KLEVAR_TELEGRAM_BOT_TOKEN", "<bot-token>", "User")
[Environment]::SetEnvironmentVariable("KLEVAR_TELEGRAM_CHAT_ID", "<chat-id>", "User")
```

With both variables present, the runtime sends a Telegram alert when a batch fails or stops for recovery/human attention. Successful batch notifications are opt-in:

```powershell
[Environment]::SetEnvironmentVariable("KLEVAR_TELEGRAM_NOTIFY_COMPLETE", "1", "User")
```

Disable all Telegram runtime notifications without removing the token:

```powershell
[Environment]::SetEnvironmentVariable("KLEVAR_TELEGRAM_NOTIFY", "0", "User")
```

Runtime test projects named `klevar-yolo-test-*` are suppressed by default even when Telegram environment variables are configured, so local regression tests do not spam the real alert channel. Set `KLEVAR_TELEGRAM_NOTIFY_TESTS=1` only when intentionally testing Telegram delivery itself.

Never commit bot tokens, chat IDs, or notification secrets to project files.

## Public Release Posture

`tools/klevar-yolo-runtime/`, `.pi/`, wrapper scripts, and this documentation are intended to remain with projects that want public Pi runtime support. Runtime audit state under `.yolo/` is tracked during development but stripped by `/prepare-public`; if `.yolo/runtime.config.json` is removed during public prep, the runtime recreates default config on first run. Ephemeral/runtime-generated paths are always gitignored: `.yolo/worktrees/`, `.yolo/pi-sessions/`, `.yolo/subagent-prompts/`, `.yolo/subagent-runs/`, `.yolo/events/`, `.yolo/logs/`, `.yolo/incidents/`, `.yolo/command-runs/`, `.yolo/runtime-state.json`, `tools/klevar-yolo-runtime/node_modules/`, and `tools/klevar-yolo-runtime/dist/`.

## Runtime Files

| Path | Purpose |
|------|---------|
| `.yolo/runtime.config.json` | Model routing, gate policy, path policy |
| `.yolo/pi-sessions/` | One Pi session per master/sub-agent run |
| `.yolo/subagent-prompts/` | Exact materialized prompts for replay |
| `.yolo/subagent-runs/` | JSON manifests for every sub-agent invocation; over-budget prompt preflights write `<id>-context-budget.json` here |
| `.yolo/command-runs/` | Redacted large stdout/stderr and summary artifacts for failed command reruns |
| `.yolo/batch-results/` | Human + JSON batch outputs |
| `.yolo/worktrees/` | Isolated implementation worktrees |
| `.yolo/journal.md` | Runtime journal |
| `.yolo/runtime-state.json` | Live runtime state for dashboard/watch UI; gitignored generated state |
| `.yolo/events/batch-###.jsonl` | Runtime event stream for current/previous batches; gitignored generated state |
| `.yolo/incidents/` | Local poisoned-exit evidence fixtures; gitignored operational artifacts with flattened copied evidence paths |
| `.yolo/gates/` | Runtime and sub-agent proof-on-disk gates |
| `.yolo/failure-patterns.json` | Recurring failure signatures and reinforcement state |

## Wired-or-Fail

Entrypoint work (`[API]`, `[UI]`, `[JOB]`, `[INTEGRATION]`) must prove reachability. A handler, component, job, or command existing on disk is not enough. Result JSON must include `wiring.entrypoints[]` with `verifiedBy` evidence.

If no reachable path exists, the result must fail with:

```json
{
  "status": "FAILURE",
  "failureType": "UNWIRED_CODE"
}
```

## Hardened Honesty Gates

The runtime now ports the load-bearing YOLO safeguards into code:

- Active `.agent/knowledge/checks/*.md` files are injected into sub-agent context; result JSON must report how many checks were evaluated and whether any triggered.
- Repeated failure signatures are recorded in `.yolo/failure-patterns.json`; after `reinforcementThreshold` recurrences, the runtime dispatches `yolo-subagent-reinforce.md`.
- Runtime gate files are written under `.yolo/gates/` for machine gates, E2E, journal, and closeout; the next batch refuses to start if the previous batch is missing core gates.
- `[AUDIT]` progress items dispatch `yolo-subagent-audit-coverage.md` instead of the implementation agent.
- Journal closeout dispatches `yolo-subagent-journal.md` and writes a journal gate.
- `docs/yolo-inbox.md` pending entries are included in context and entries listed in `inbox.handledTitles` are moved to Handled after a successful batch.
- Generated artifacts listed in result JSON are checked for duplicate content to catch placeholder-stuffing.
- Business-bearing batches must include `businessLogic` evidence tying the behavior to a source-of-truth rule, observable paths, and a proving test.
