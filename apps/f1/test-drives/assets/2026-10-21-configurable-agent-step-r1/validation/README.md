# Final revision validation for #136 / PR #173

Validated production source: **`f926f6c18be3ccdf1acd1593648719ae9523d247`**. Main integrated without rewriting history: `4e32ed07947ca1cec5e5a514b6e0b941e73d6bd7`, merge `c359d87ca7e519116d04ac5770852b65496ab74c`. Worktree: `/Users/jappy/.t3/worktrees/bobs-factory/ticket-136-agent-step-recovery`; branch `t3/ticket-136-agent-step-recovery`. [PR #173](https://github.com/jappyjan/bobs-factory/pull/173) remains unmerged and requires a new independent review.

Node **24.21.0**, pnpm **10.33.1**, Bun **1.4.2**. Node 24.x is the sole supported source/build runtime; CI/release and `.node-version` pin 24.18.0. Old Node support removal does not remove legacy recipe loading. New evidence remained outside the checkout until complete validation, so the actual binary and both Factory drives ran from clean source.

## Complete final gates

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm build` (clean generated output) | PASS | [Complete log](final-build.log) |
| `pnpm typecheck` | PASS | [Complete log](final-typecheck.log) |
| `pnpm lint --max-diagnostics=100` | PASS | [Complete log](final-lint.log) |
| `pnpm test:packages:run --maxWorkers=2` | PASS | [Complete log](final-packages.log) |
| `pnpm --workspace-concurrency=1 --filter ./apps/cli --filter ./apps/f1 test:run --maxWorkers=1` | PASS | [Complete log](final-apps-vitest.log) |
| `pnpm --filter ./apps/desktop test:run` | PASS | [Complete log](final-desktop.log) |
| `node --test --test-concurrency=2 scripts/tests/archive-path.test.mjs scripts/tests/artifact-handoff.test.mjs scripts/tests/beta-attestation.test.mjs scripts/tests/bounded-archive.test.mjs scripts/tests/desktop-runtime.test.mjs scripts/tests/desktop-shell-drive.test.mjs scripts/tests/native-receipts.test.mjs scripts/tests/nightly-artifacts.test.mjs scripts/tests/nightly-baseline.test.mjs scripts/tests/nightly-source.test.mjs scripts/tests/nix-beta-attestation.test.mjs scripts/tests/prepared-evidence-intake.test.mjs scripts/tests/public-install.test.mjs scripts/tests/release-candidate.test.mjs scripts/tests/release-discovery.test.mjs scripts/tests/release-extensions.test.mjs scripts/tests/release-material.test.mjs scripts/tests/release-publication.test.mjs scripts/tests/reviewed-javascript-sources.test.mjs scripts/tests/source-transport.test.mjs scripts/tests/trial-launcher-bootstrap.test.mjs scripts/tests/trial-launcher.test.mjs scripts/tests/unsigned-release-flow.test.mjs scripts/tests/website-downloads.test.mjs` | PASS | [Complete log](final-scripts.log) |
| `pnpm audit` | PASS | [Complete log](final-audit.log) |
| `actionlint` | PASS | [Complete log](final-workflow-lint.log) |

[Structured commands, exact identity, start/end times and exit codes](final-gates.json.txt). Every log is complete; the package command covers the entire packages workspace, followed by complete CLI/F1, desktop and script suites. No failed-test filtering or repeated CI retry is used. [Machine-readable test counts](test-counts.json.txt).

### packages

```text
packages/cloudflare-tunnel-client test:run:  Test Files  2 passed (2)
packages/cloudflare-tunnel-client test:run:       Tests  26 passed (26)
packages/core test:run:  Test Files  19 passed (19)
packages/core test:run:       Tests  263 passed (263)
packages/mcp-tools test:run:  Test Files  14 passed (14)
packages/mcp-tools test:run:       Tests  82 passed (82)
packages/gitlab-event-transport test:run:  Test Files  1 passed (1)
packages/gitlab-event-transport test:run:       Tests  11 passed (11)
packages/github-event-transport test:run:  Test Files  5 passed (5)
packages/github-event-transport test:run:       Tests  117 passed (117)
packages/slack-event-transport test:run:  Test Files  3 passed (3)
packages/slack-event-transport test:run:       Tests  82 passed (82)
packages/linear-event-transport test:run:  Test Files  6 passed (6)
packages/linear-event-transport test:run:       Tests  75 passed (75)
packages/claude-runner test:run:  Test Files  12 passed (12)
packages/claude-runner test:run:       Tests  137 passed (137)
packages/zulip-event-transport test:run:  Test Files  3 passed (3)
packages/zulip-event-transport test:run:       Tests  25 passed (25)
packages/config-updater test:run:  Test Files  8 passed (8)
packages/config-updater test:run:       Tests  52 passed (52)
packages/simple-agent-runner test:run:  Test Files  2 passed (2)
packages/simple-agent-runner test:run:       Tests  24 passed (24)
packages/gemini-runner test:run:  Test Files  4 passed (4)
packages/gemini-runner test:run:       Tests  200 passed | 1 skipped (201)
packages/cursor-runner test:run:  Test Files  8 passed (8)
packages/cursor-runner test:run:       Tests  56 passed (56)
packages/codex-runner test:run:  Test Files  17 passed (17)
packages/codex-runner test:run:       Tests  140 passed (140)
packages/opencode-runner test:run:  Test Files  4 passed (4)
packages/opencode-runner test:run:       Tests  34 passed (34)
packages/edge-worker test:run:  Test Files  193 passed (193)
packages/edge-worker test:run:       Tests  2473 passed | 1 skipped (2474)
```

### apps-vitest

```text
 Test Files  21 passed (21)
      Tests  251 passed (251)
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

### desktop

```text
ℹ tests 42
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
```

### scripts

```text
ℹ tests 179
ℹ pass 179
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```


## Source, artifact and dependency identity

[Clean-build manifest](final-build-manifest.json.txt) records all **1,136** source/build/test inputs and **1,740** artifact files. Input digest `7b4cfc626b70a41b6e0317938676a6119bd42ad8035ae156ca8202a8c0622639`; full artifact-file digest `773c896829c5bb92961c5b7b67184e5a9c5ea434ee00ee98763f29457184b247`. [Before-clean generated-file manifest](pre-clean-artifacts-final.json.txt) preserves previous identities. Only ignored generated `dist` directories with no tracked files or symlinks were removed; unrelated files and both recovery checkouts were preserved. Final web output contains exactly one build, `439e34cad97e0e35a98dcbb4`, with no obsolete web directories.

Lockfile SHA256: `4d5086fbe1f4c882dd7466a569a75da99817eda5a9adeb89aa7526cc86406e72`. [Final dependency proof](dependency-identity-final.json.txt): **892 locked / 950 installed identities**, identical to accepted owning-dependency/override cleanup, including the entire parsed recursive installed graph and its edges. [Retained resolved identities](resolved-final.json.txt). No review-revision dependency changes. The complete final audit above reports zero advisories.

Owning bumps and every override removal remain documented in the [original cleanup evidence](../../2026-10-21-configurable-agent-step/validation/override-review.md): direct Ajv 8.20.0 in edge-worker; MCP SDK 1.32.1 in its owners; Vitest/UI/coverage 4.1.12 and Vite 8.3.5 in their owners; Axios/Hono/node-server reach patched transitives naturally. Eleven redundant overrides were removed together; four necessary overrides retain their reasons. Historical before/after identities, install and audit records are preserved.

## R1–R7 and compatibility evidence

The [point-by-point response matrix](../../../../../../docs/factory/agent-step-review-round1.md) records each actual root cause, fix and regression suite. [Every changed existing-test mechanism](../../../../../../docs/factory/agent-step-test-changes.md) is explained without dropping behavioral/security assertions. The complete final package gate reruns these suites on the source above; focused before/after logs remain here separately.

| Finding | Relevant focused evidence |
| --- | --- |
| R1 bounded custom schemas, safe cycles, correction/cancel | [HTTP/schema/full-prompt](r1-api-schema-prompt.log), [native recovery](r1-native-recovery.log), [actual final binary](binary-final/README.md) |
| R2 exact producer/frame and selected-repository authority | [provider/provenance/media](r2-provider-provenance-media.log), [QA inputs](r2-r3-qa-inputs.log), [native](r2-r5-native.log) |
| R3 effective input freshness, restart and no side-effect replay | [history before](r3-history-before.log), [after](r3-history-after.log), [native feedback before](r3-native-feedback-before.log), [after](r3-native-feedback-after.log) |
| R4 original pinned snapshot | [before-fix reproduction](r4-before.log), complete final `EdgeWorker.pinned-inspection` and revision-binding suites |
| R5 explicit protocol opt-in | [existing protocols](r5-existing-protocols.log), complete final `ImpactOptIn`/storage evidence suites |
| R6 current operational readiness | [API/UI suites](operational-review-focused.log), [final real browser/API](final-ui-backend-recheck.json.txt) |
| R7 config-derived review action/presentation | [focused regressions](r6-r7-focused.log), [server/action tests](r6-r7-server-review.log), [final browser action](final-ui-backend-recheck.json.txt) |

[Immutable prompt fixture proof](prompt-fixture-identity.json.txt): **675 complete stock/frozen variants**, unchanged from the independently reviewed fixture. The full capability-reference expected prompt is updated intentionally. Production old-shape coverage is **one true restart plus five conditional-input cases**, without test-only compatibility registration; additional persisted merge-recovery cases remain covered. Original retry, convergence, approval, media, provider and security assertions remain.

## Factory F1, screenshots and binary

[Final F1 report and screenshot gallery](../../../2026-10-21-configurable-agent-step-r1.md): stock and every-step-renamed Factory both complete, **21 native calls / 23 activities / 24 comments each**, explicit approval, **zero paid calls**. Real local Git/push and native mock events use scripted forge responses. Only the exact six contiguous configured parallel specialists may reorder; each executes once and serial/tool/publication/approval assertions remain exact. [Before/after executed-JavaScript identity](final-f1-identity.json.txt).

Twenty inspected screenshots cover builder plus pending-readiness/renamed-review behavior at desktop and 390px, light/dark. Capture source `50e02029`; final backend and action/poll checks rerun on `f926f6c18be3ccdf1acd1593648719ae9523d247`. **All 11 UI files are byte-identical** to capture: [hashes](final-ui-hashes.json.txt), [full browser/capture proof](../ui-validation.json.txt), [final backend](final-ui-backend-recheck.json.txt). This is explicit screenshot reuse of the same final UI, not a claim of new captures.

[Actual final complete native binary evidence](binary-final/README.md) covers darwin-arm64, embedded Bun 1.4.2, source `f926f6c18be3ccdf1acd1593648719ae9523d247` and `dirty=false`. Executable SHA256 `7f761a6fe467294b6aef670aefc6d18f72dd8750a16a5046f81dca38ffb6782f`. Real HTTP/private-helper deadline/cancellation, canonical startup/protected API/assets/MCP/restart and isolated install/reinstall/state/checksum rejection pass. A clearly labelled SIGSTOP of only its own validator child proves the production OS-child deadline; 2,165ms request and 17 concurrent catalog probes (max 18ms). The original compiled fixture's natural pathological-regex proof remains separate. All input/artifact hashes match before/after. No binary/archive was committed or published. Factory needs no external Node/Bun; Git, prepared agent tools/SDKs/native sidecars/credentials and optional ffprobe/ffmpeg remain external. Node 24 is required for source tooling and the separate prepared Cursor host/trial launcher.

## CI failures, fixes and preliminary records

- Run 39640902267, source `0cdb5fa`: [complete Node22 log](ci-node22-0cdb5fa.log), [complete Node24 log](ci-node24-0cdb5fa.log), [set comparison](ci-matrix-comparison.json.txt). Install/build passed. Exactly **53 common failures**, plus one Node22-only invalid timing assumption for an otherwise valid schema. Exact accepted producer/frame/frozen repository fixture setup now preserves every original security/outcome assertion. The valid-schema check tests responsiveness and bounded completion; unknown-keyword rejection remains. Actual active-frame recovery and screenshot-binding defects were fixed too. Node22 support was then removed by explicit user instruction; shared product failures were not hidden.
- Run 39646488717, source `50e02029`, [job119383310302](https://github.com/jappyjan/bobs-factory/actions/runs/39646488717/job/119383310302): [complete log](ci-node24-50e02029.log), [summary](ci-node24-50e02029-summary.json.txt). Install/build passed; package **49 failed / 2420 passed / 1 skipped**. Forty-eight incomplete-graph `.every` exceptions are fixed by refusing legacy authority without `steps`; one needless cold-history scan is fixed by returning before lookup when no accepted producer exists. Unchanged native47, Incremental and cold-history assertions pass [focused native/provenance](node24-native-provenance-after-guard.log), [Incremental](incremental-after-guard.log), [cold history](cold-history-after-empty-lookup.log), and the complete final gate above.
- The last bounded Node support audit fixed a duplicate execution-profile Cursor >=22.13 gate to exact major24; [all10 focused cases](node24-profile-gate.log) pass, including selected-executable assertions and unsupported20/22/23/25/invalid negatives. Other old-version hits are historical evidence or type/API comments and were preserved.
- Existing durable-filesystem integration tests retain assertions, with bounded outer allowances and try/finally mock cleanup. [Unchanged isolated core proof](core-storage-unchanged-isolated.log), [after lifecycle fix](core-storage-after-test-lifecycle.log), [grouped route after allowance](grouped-storage-after-budget.log). Production claim/command/deletion deadlines are unchanged. Integrated-main storage references use explicit checks and exact frames: [focused references](storage-reference-final-focused.log), [before](storage-f1-before-policy-fix.log), [after](storage-f1-after-policy.log).
- The first final app command launched CLI and F1 workspaces concurrently. One unchanged CLI update-preservation case exceeded its 5-second outer timeout; [complete initial log](apps-concurrent-before.log), [initial gate record](initial-gates-before-app-scheduling.json.txt). Its four unchanged cases pass in isolation with 320–647ms bodies. The complete app suites then run sequentially using workspace concurrency1, after the other filesystem-heavy checks drain. [Investigation and remedy](app-scheduling-investigation.json.txt), [unchanged focused output](owned-update-unchanged-isolated.log). No source, fixture, assertion, production deadline or default test timeout was changed for this scheduling correction. Both complete final app suites must pass before this index can be generated.
- Earlier output is explicitly preliminary under `preliminary-*`/`binary-*-*`; it is not final-head green evidence. The partial807b package gate was deliberately stopped before the final Node policy source change. Complete original historical reports/assets remain unchanged.

The parent watch reports **all five CI checks passed on exact `f926f6c18be3ccdf1acd1593648719ae9523d247`**, mergeable against main `4e32ed07947ca1cec5e5a514b6e0b941e73d6bd7`. This records the received notification; no CI watcher, poll or blind retry was started here. A later evidence-only PR head is identified separately with source/artifact equivalence, without relabelling CI runs.

Parent owns subsequent CI notifications and the new independent acceptance review. These local results do not claim review approval, live model/provider quality, real remote merge, cross-platform binary execution or release publication. No merge or later-ticket work was performed.
