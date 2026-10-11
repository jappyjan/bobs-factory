# Unsigned delivery: focused implementation validation

Date: 2026-10-11. PR: [#96](https://github.com/jappyjan/bobs-factory/pull/96).
Task: [Taskbot #116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116), children 117–124.
Implementation source: `81715b61ca17b699d7d4d00c56c4a349dbde1f0a`.
Verified main base: `3b198a1ee3bf26eefa536de3a9f5d1a771abf034`.
Isolated checkout: `/Users/jappy/code/jappy/bobs-factory-unsigned-116`.
Subsequent changes are this evidence, changelog/PR links and integrity wording only;
they do not change production, build, workflow or test source.

## Changed behavior and applicability

The public release consumers and publisher use direct GitHub HTTPS and complete
candidate-bound SHA256/size inventories. Apple Developer ID/notarization/stapling,
protected signing infrastructure and pinned RSA publisher signatures are no longer
blocking requirements. These checks establish integrity, without independent
publisher authentication. Existing source intake, immutable publication snapshots,
stable/nightly provenance, candidate consent, ownership and rollback remain.

The changed runtime/desktop update source is validated through the functional
unsigned fixture chain and focused update suites. Relevant F1 scope is the surrounding
worker admission/drain and retained workflow lifecycle: maintenance must preserve
accepted work, and an unsigned update must still respect policy, busy capacity,
human gates and rollback boundaries. Release scripts/CI/docs/packaging are assessed
with their targeted checks, rather than an unrelated generic F1 drive.

## Commands and results

- `node --test scripts/tests/{release-publication,release-discovery,source-transport,public-install,beta-attestation,trial-launcher-bootstrap,unsigned-release-flow,nix-beta-attestation,release-candidate,archive-path,bounded-archive}.test.mjs`: **123/123 passed** at implementation source.
- `pnpm --filter bobs-factory-desktop test:run`: **29/29 passed**, including unsigned macOS integrity proof and complete-app candidate/receipt tamper refusals. The production update-services bundle compiled with no removed signing/key imports.
- `pnpm --filter bobs-factory-edge-worker test:run PublishedUpdateSource.test.ts UpdateManager.test.ts`: **58/58 passed**.
- `node scripts/tests/signed-delivery-harness-regressions.mjs /tmp/bobs-unsigned-harness-regressions.json`: **14/14 passed**. The retained helper filename describes its historical lineage; this invocation tests bounded child shutdown and immutable/nonpassing receipt cleanup, not the native signed23 scenario matrix.
- `F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/tmp/bobs-unsigned-f1-exact-maintenance node apps/f1/test-drives/assets/update-maintenance.mjs`: **9 assertions passed**.
- `F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/tmp/bobs-unsigned-f1-exact-lifecycle node apps/f1/test-drives/assets/update-lifecycle.mjs`: **10 assertions passed**, peak one controlled worker.
- Normal commit hooks passed `lint-staged`, `pnpm build` and `pnpm typecheck`. Modified JS/CJS and shell syntax passed. Ruby Psych parsed the four changed workflows. No Nix executable was available; the unchanged legacy inventory jq behavior passed targeted checks, without claiming a Nix build.

[Check summaries and log hashes](assets/2026-10-11-unsigned-delivery/checks.json.raw)
retain the actual local validation results. The desktop/worker runs preceded the
normal commit; the committed source retains those tested behaviors. Release suite
and final F1 drives ran at the committed implementation source, with only documentation
wording dirty. The F1 raw receipts retain their emitted `testedCommit: working-tree`
literally; this report records the source binding without rewriting their bytes.

## Functional unsigned chain

`unsigned-release-flow.test.mjs` invokes the actual publisher using a controlled
provider and explicitly simulated native/review evidence. It produces an unsigned
publication plan and complete inventory, discovers that exact published fixture,
runs unchanged prepared/source intake, reconstructs bounded chunks offline and
verifies the full original archive hash/size. The actual `PublishedUpdateSource`
extracts and probes the fixture executable. Controlled health failure causes
`UpdateManager` rollback while retaining the previous runtime.

Wrong selected source identity, corrupt archive downloads and a custom client that
returns unchecked corrupted bytes are refused before execution/activation. Public
installer checks additionally reject wrong manifest candidate/tooling identity while
preserving the existing executable link/profile. Publication tests retain conflicting
inventory, post-validation snapshot races, pinned upload streams, immutable draft
recovery and publication ordering. Existing source transport tests retain bounded
reconstruction and semantic rejection of hybrid or incomplete source material.

## F1 observations

[Maintenance receipt](assets/2026-10-11-unsigned-delivery/update-maintenance.json.raw):
actual EdgeWorker/OperatorServer startup, accepted ticket preflight, authenticated
inspection, seven frozen mutation refusals and real tools/list descendants are
exercised. Accepted work drains naturally through its exact capacity owner; the
idle barrier waits through final state persistence. Mismatched release does not
resume work; the exact successful release resumes pending dispatch once.

[Lifecycle receipt](assets/2026-10-11-unsigned-delivery/update-lifecycle.json.raw):
busy/capacity deferral, policy cancellation at authenticated intake freeze, startup
writer contention, one controlled worker, retained mock-native session/checkpoint,
waiting answers/review gates/frozen definitions, failed-health rollback and independent
homes passed. Answer continuation uses the preserved mock-native session ID.

[Cleanup receipt](assets/2026-10-11-unsigned-delivery/harness-regressions.json.raw)
retains all 14 bounded shutdown and evidence-finalization outcomes.

## Scope and remaining native validation

The release provider and native/review receipts in the functional fixture are
simulated deliberately. Mock F1 uses controlled candidates/supervisors and does
not prove native OS service restart, real provider/native credentials or physical
authenticator behavior. Existing signed23, native builds and packet/source-intake
records remain bound to their original sources; none is relabeled or rerun here.

The free local ad-hoc Apple Silicon packaging hook is syntax/review checked only.
It preserves existing nested code and frozen runtime bytes; actual packaged executable
validity still requires native target evidence. No application/binary native build,
new freeze/build dispatch, quarantined DMG first-launch exercise, real public release,
catalog publication, production installation/services, merge or ticket closure occurred.
Future first-launch validation must preserve quarantine and the per-app OS permission
boundary described in [desktop guidance](../../../docs/distribution/DESKTOP.md).
No global Gatekeeper disable, quarantine clearing, shared keychain group or new native
credential-store reads are introduced. Actual final-candidate source/licensing,
minimum-platform and functional workflow/target acceptance remain separately scoped.
