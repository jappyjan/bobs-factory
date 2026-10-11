# PR96 round 1 correction validation

Date: 2026-10-11. [PR96](https://github.com/jappyjan/bobs-factory/pull/96),
[Taskbot116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116).
Reviewed old head: `f7ab57ea1699a85272fa610fe9950cb144033cd7`.
Tested implementation correction: `0aab1ecbf0fb479f1c95a70aed9f45b160a69afd`.
App-owned isolated checkout: `/Users/jappy/code/jappy/bobs-factory-unsigned-review-96`.
The subsequent commit adds only this report and fresh raw evidence, with no further
production/build/workflow/test changes. Root and the original implementation
checkout remain untouched; both independent round1 reviews were terminal before
pushing the correction. Fresh independent Standards/Spec review remains required;
this report is implementation validation, not an independent approval or release.

## Standards P2: lost quarantine

[Original review](assets/2026-10-11-unsigned-review-fixes/standards-round1.md.raw)
SHA256: `de6e6c87b1c2347cb0d9a91e7aee8d55e228652226d2d7bb3f281b0e0fedd0cb`.

The supplied real-filesystem reproduction confirmed that the installed old app
and retained previous app had `com.apple.quarantine`, while framed extraction and
Node replacement lacked it. The installed fingerprint still matched. This was
loss of host OS metadata, outside the unchanged package byte/mode/link inventory.
[Original result](assets/2026-10-11-unsigned-review-fixes/quarantine-original-repro.json.raw).

The installed per-app quarantine bytes are now applied to actual staged extraction.
Activation transfers the staged state and installed app's current state before
renaming, accounting for OS changes since staging. The switch journal separately
retains the attribute for interrupted recovery/rollback and pre-launch reconciliation.
Absent metadata never clears a destination attribute; inspection/write errors block.
Only this app's quarantine attribute is accessed, without native credential/keychain
reads, global OS settings, publisher signing or deletion of quarantine.

`apps/desktop/test/app-quarantine.test.mjs` uses `/usr/bin/xattr` on real temporary
macOS directories, actual archive/source verification and lifecycle methods.
It covers staging, replacement/rollback and interrupted missing-install recovery,
including an attribute change after staging/snapshot. All three fail with the old
production head because quarantine disappears, and pass with the fix while the
full app fingerprint stays unchanged. No fixture executable is launched.
[Red regression](assets/2026-10-11-unsigned-review-fixes/quarantine-red.log.raw).
Linux skips these OS-specific assertions; this Mac ran all three without skips.

## Spec P2: historical beta approval race

[Original review](assets/2026-10-11-unsigned-review-fixes/spec-round1.md.raw)
SHA256: `eca4a828698a4b40628b3f332712add371ef595e4e65d492ea4770b040f3431a`.

The supplied isolated race reproduced approved/provenance build123 being replaced
by build124 after approval read, followed by successful preparation and discovery
of the unapproved manifest. Full retained prepared validation still rejected it.
[Original result](assets/2026-10-11-unsigned-review-fixes/beta-original-repro.log.raw).

`prepare-beta-attestation.mjs` now derives the emitted manifest SHA256/size only
from the validated and approved `manifestBytes` buffer. It compares retained
bytes before and after output; a late change removes only the newly emitted
attestation and refuses completion. Inventory records remain the approved snapshot.

The actual beta preparation regressions inject changes at both approval-file read
and output write. Both fail against the old preparation code and pass after the
fix, requiring refusal and no retained additive attestation.
[Red regressions](assets/2026-10-11-unsigned-review-fixes/beta-red.log.raw).
The adjacent byte boundaries were inspected: publisher snapshots use the fixed
validated manifest buffer, offline recovery supplies `expectedManifestBytes` and
rechecks it, and discovery binds the attestation to downloaded manifest bytes.
No frozen inventory is regenerated from a post-approval replacement.

## Spec P2: broken maintained complete-shell F1 entry point

The old documented mock command failed at module linkage because the fixture's
removed `keys` export was still imported. Obsolete key/trusted-key constructor
wiring is now removed from the maintained executable driver. Historical F1 report
and receipt bytes are unchanged; only the current driver is corrected.

The durable `scripts/tests/desktop-shell-drive.test.mjs` invokes the actual
maintained driver, rather than testing source text. It is red with the exact old
`f7ab` driver, and green with the fix.
[Red result](assets/2026-10-11-unsigned-review-fixes/shell-red.log.raw),
[actual scoped drive receipt](assets/2026-10-11-unsigned-review-fixes/shell-green.json.raw).
Its five assertions cover active-lease deferral without signaling UI/worker,
unsigned activation retaining worker PID/nonce and waiting state, interrupted
complete-app recovery, failed-shell rollback with bad-candidate suppression, and
independent settings/no automatic retry. Actual FactoryServer, WorkflowRuntime,
UpdateDrain, capacity/owner records and scripted UI processes are exercised.
Agents/providers are mocked; no native Electron or OS allow-running claim is made.

## Verification

- Exact correction source: `node --test apps/desktop/test/app-quarantine.test.mjs scripts/tests/beta-attestation.test.mjs scripts/tests/desktop-shell-drive.test.mjs`: **8/8 passed**, including the actual complete-shell F1 driver. [Exact green results](assets/2026-10-11-unsigned-review-fixes/exact-green.log.raw).
- `pnpm --filter bobs-factory-desktop test:run`: **32/32 passed**, including actual macOS xattrs and existing integrity/ownership/recovery refusals.
- `node --test scripts/tests/{release-publication,release-discovery,source-transport,public-install,beta-attestation,unsigned-release-flow,desktop-shell-drive}.test.mjs`: **95/95 passed**. Existing immutable publication/snapshot races, wrong candidate/corrupt payload refusals, bounded semantic source recovery and runtime rollback remain covered.
- Direct actual driver command: `F1_AGENT_MODE=mock node apps/f1/test-drives/assets/desktop-shell-update.mjs`: **all five assertions passed**.
- Normal hooks passed `lint-staged`, build and typecheck. Changed module syntax, Biome and `git diff --check` passed. Build means ordinary TypeScript/JS compilation and desktop service bundling, not a native product build.

[Check summaries/log hashes](assets/2026-10-11-unsigned-review-fixes/checks.json.raw)
retain the broader precommit runs. Normal hooks retain those tested source
behaviors; the eight focused cases were rerun at the committed correction source.
Quarantine/beta red tests were added before the fixes. The executable-driver
regression and the final beta cases also ran with exact old module content in this
isolated checkout, then the fixed modules were restored before broader checks.
No original or root checkout was edited for these comparisons.

Real filesystem metadata preservation does not prove Gatekeeper acceptance,
quarantined DMG first launch, native app packaging/ad-hoc validity or real provider
continuation. Those future observations must preserve the user's per-app OS allow
boundary. No paid signing, global protection disable, native build/freeze/dispatch,
historical broad signed23 rerun, public release/catalog, production installation/
service changes, merge or ticket closure was performed.
