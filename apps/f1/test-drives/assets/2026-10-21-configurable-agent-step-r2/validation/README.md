# Round2 validation for Taskbot #136 / PR #173

Validated production source **7106f734ca6fc4066448e2766495f5bacb4fa0d9**, main 4e32ed07947ca1cec5e5a514b6e0b941e73d6bd7; isolated recovery worktree/branch `ticket-136-agent-step-recovery` / `t3/ticket-136-agent-step-recovery`. Node 24.21.0, Bun 1.4.2, pnpm 10.33.1. No merge, deployment, active-run edits or later-ticket implementation. #137–143 and epic follow-ups #144–148 remain separate. Future context shaping must preserve effective-input revision binding and exact producer/frame provenance.

## Complete gates

Complete clean build and all eight complete gates PASS; exact commands and logs below.

| Command | Result | Complete log |
| --- | --- | --- |
| `pnpm build` (clean generated output) | PASS | [Build](final-build.log) |
| `pnpm typecheck` | PASS (exit0) | [typecheck](final-typecheck.log) |
| `pnpm lint --max-diagnostics=100` | PASS (exit0) | [lint](final-lint.log) |
| `pnpm test:packages:run --maxWorkers=2` | PASS (exit0) | [packages](final-packages.log) |
| `pnpm --workspace-concurrency=1 --filter ./apps/cli --filter ./apps/f1 test:run --maxWorkers=1` | PASS (exit0) | [apps-vitest](final-apps-vitest.log) |
| `pnpm --filter ./apps/desktop test:run` | PASS (exit0) | [desktop](final-desktop.log) |
| `node --test --test-concurrency=2 scripts/tests/archive-path.test.mjs scripts/tests/artifact-handoff.test.mjs scripts/tests/beta-attestation.test.mjs scripts/tests/bounded-archive.test.mjs scripts/tests/desktop-runtime.test.mjs scripts/tests/desktop-shell-drive.test.mjs scripts/tests/native-receipts.test.mjs scripts/tests/nightly-artifacts.test.mjs scripts/tests/nightly-baseline.test.mjs scripts/tests/nightly-source.test.mjs scripts/tests/nix-beta-attestation.test.mjs scripts/tests/prepared-evidence-intake.test.mjs scripts/tests/public-install.test.mjs scripts/tests/release-candidate.test.mjs scripts/tests/release-discovery.test.mjs scripts/tests/release-extensions.test.mjs scripts/tests/release-material.test.mjs scripts/tests/release-publication.test.mjs scripts/tests/reviewed-javascript-sources.test.mjs scripts/tests/source-transport.test.mjs scripts/tests/trial-launcher-bootstrap.test.mjs scripts/tests/trial-launcher.test.mjs scripts/tests/unsigned-release-flow.test.mjs scripts/tests/website-downloads.test.mjs` | PASS (exit0) | [scripts](final-scripts.log) |
| `pnpm audit` | PASS (exit0) | [audit](final-audit.log) |
| `actionlint` | PASS (exit0) | [workflow-lint](final-workflow-lint.log) |

The clean `pnpm build` log and [manifest](final-build-manifest.json.txt) are separate from the eight complete gate exits in [final-gates.json.txt](final-gates.json.txt). Each final command must exit 0. Complete package, CLI/F1, desktop and script sweeps remain intact; no failed-test filtering or CI retry substitutes for them.

Raw tool logs retain their original bytes, including terminal spacing and trailing blank lines. They are not reformatted as source files.

### Complete-command test counts

Derived from terminal summary lines in the complete final logs; no focused/manual F1/binary run is added to this total. Skipped/todo cases remain separate from passing cases.

| Workspace / suite | Vitest files | Passed | Skipped | Todo | Total cases |
| --- | --- | --- | --- | --- | --- |
| `packages/cloudflare-tunnel-client` | 2 | 26 | 0 | 0 | 26 |
| `packages/core` | 19 | 263 | 0 | 0 | 263 |
| `packages/mcp-tools` | 14 | 82 | 0 | 0 | 82 |
| `packages/gitlab-event-transport` | 1 | 11 | 0 | 0 | 11 |
| `packages/github-event-transport` | 5 | 117 | 0 | 0 | 117 |
| `packages/slack-event-transport` | 3 | 82 | 0 | 0 | 82 |
| `packages/claude-runner` | 12 | 137 | 0 | 0 | 137 |
| `packages/linear-event-transport` | 6 | 75 | 0 | 0 | 75 |
| `packages/zulip-event-transport` | 3 | 25 | 0 | 0 | 25 |
| `packages/config-updater` | 8 | 52 | 0 | 0 | 52 |
| `packages/simple-agent-runner` | 2 | 24 | 0 | 0 | 24 |
| `packages/gemini-runner` | 4 | 200 | 1 | 0 | 201 |
| `packages/cursor-runner` | 8 | 56 | 0 | 0 | 56 |
| `packages/codex-runner` | 17 | 140 | 0 | 0 | 140 |
| `packages/opencode-runner` | 4 | 34 | 0 | 0 | 34 |
| `packages/edge-worker` | 198 | 2519 | 1 | 0 | 2520 |
| `apps/cli` | 22 | 254 | 0 | 0 | 254 |
| `apps/f1` | 2 | 17 | 0 | 0 | 17 |
| `apps/desktop` | — | 41 | 1 | 0 | 42 |
| `scripts/tests` | — | 179 | 0 | 0 | 179 |
| **All complete commands** | — | **4334** | **3** | **0** | **4337** |

Failures: 0; cancelled: 0. Package-only and app-only aggregates, raw terminal lines and source log hashes are retained in [test-counts.json.txt](test-counts.json.txt).


## Identity and dependencies

The build and before/after binary/F1 proofs check 1,145 committed source/build/test inputs and 1,740 generated artifact files. Input digest `f92022cd6f7880be4eb531d027bb3df7ca947ac8ac237a6165f3ab9ea882adfb`; artifact digest `f19164f64fa9050e49b04f4a5bb56b9cceea8c40a8115e57c5a584f110796ad1`. [Pre-clean artifact inventory](pre-clean-artifacts-final.json.txt) retains the former generated state. Evidence stayed under `/tmp` until validation ended. [Root implementation verification](root-evidence-verification.json.txt) recomputes all32 PNG hashes/dimensions, exact artifact sets, binary SHA and F1 metadata on clean7106; [its script](root-evidence-proof.py.txt) is retained. This is separate from independent acceptance review.

[Dependency proof](dependency-identity-final.json.txt), [resolved identities](resolved-final.json.txt), and [current recursive graph](installed-graph.json.txt): lockfile `4d5086fbe1f4c882dd7466a569a75da99817eda5a9adeb89aa7526cc86406e72`,892 locked / 950 installed identities match accepted owning-bump/override cleanup. No round2 dependency changes. The lock retains graph edges; no comparison with missing historical raw recursive edges is claimed. The final audit must report zero advisories. Historical dependency rationale remains in the [original cleanup](../../2026-10-21-configurable-agent-step/validation/override-review.md).

[Prompt fixture identity](prompt-fixture-identity.json.txt):675 complete variants / 103 shared texts, SHA256 5527a0d252575a58807ed998c0f6b13226e9cb8a12d55ac04584acc33afe33a1, unchanged from reviewed d041487e. Only the entire capability-reference expectation changes intentionally.

## Review findings and evidence

| Scope | Evidence |
| --- | --- |
| R8 architecture opt-in; R12 custom question data | [Response matrix](../../../../../../docs/factory/agent-step-review-round2.md), [R8 before](focused-before-after/ticket136-r2-generic-architecture-before.json.txt) / [after](generic-architecture-after.json.txt), [R12 before](focused-before-after/ticket136-r2-generic-question-before.json.txt) / [after](generic-questions-after.json.txt), complete package gate |
| R9 genuine historical loading/media/navigation/progress | [Current UI packet](../ui/README.md), [progress red](focused-before-after/ticket136-r2-legacy-progress-red.log.txt) / [green](focused-before-after/ticket136-r2-legacy-progress-green.log.txt), exact executed ownership and stale/tampered-media denials, complete package gate |
| R10 inner rule budget/yield/cancel | [Original accepted-config blocked-heartbeat reproduction](focused-before-after/ticket136-r10-before.json.txt), [reproducer source](focused-before-after/ticket136-r10-own-rule-repro.mjs.txt), [final Node 24/compiled-Bun parser fixture](../rule-results.json.txt), [F1 details](../F1-REPORT.md), complete package gate |
| R11 lifecycle/startup and actual product stress | [Native binary evidence](binary-final/README.md),20 focused/source cases plus actual binary loops and resource controls |
| R1–R7 preservation | [Earlier response matrix](../../../../../../docs/factory/agent-step-review-round1.md), full current schema/correction/provenance/provider/restart/pinned/impact/operational suites; original independent reproductions remain historical evidence |
| Changed existing tests | [Per-test mechanism rationale](../../../../../../docs/factory/agent-step-test-changes.md); original outcome/security assertions retained |

[Final F1 report/gallery](../../../2026-10-21-configurable-agent-step-r2.md): stock and all-renamed Factory both21 native calls/23 activities/24 comments, explicit approve,0 paid calls. Only contiguous exact declared specialist membership is unordered. Final executed JavaScript digest c1e05ac9bebdf8cef645a3cdf14fe8af820867aa403b2c3d74834da7e9c4f4cd matches before/after. Binary packet covers complete native CLI; compiled rule fixture is explicitly a parser fixture. UI screenshot source/build/backend identities are recorded separately in its packet.

## Preliminary records and documentation bridge

- Native older-binary zero-RSS reproduction, preserved 250ms ordinary-null miss, preliminary 96b 20/100 ordinary wall failures and diagnostic startup measurements remain in the binary packet. Uninstrumented failures are not assigned a proven phase or relabeled as passing.
- [Preliminary 96b F1](preliminary-96b/F1/PRELIMINARY-96b7cb03.md) completed stock then deliberately stopped the renamed session/harness (exit143), without an assertion failure, for a subsequent historical browser fix. It is not the final stock/renamed comparison. The [controlled package SIGINT](preliminary-96b/gates/interrupted-for-r9-r11.json.txt) and complete partial log are retained separately.
- Historical original/r1 reports and all failed/preliminary records stay unchanged. The parent reports all five CI checks passed on exact `7106f734`, mergeable against main `4e32ed07947ca1cec5e5a514b6e0b941e73d6bd7`. This received notification does not assign a CI result to any later documentation/evidence HEAD; parent owns subsequent notifications, without a new poll/retry here.
- [Source-to-evidence-head bridge](source-head-bridge.md) requires any subsequent commit to contain only the declared documentation/evidence paths. Production source/build/test inputs and generated artifact hashes remain validated against 7106; a docs-only HEAD is not a newly exercised source or CI run.

These records establish local implementation evidence, not independent acceptance, merge readiness, live model/provider quality, real remote merge, cross-platform binary execution or publication.
