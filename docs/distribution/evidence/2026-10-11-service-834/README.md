# Exact834 service evidence and review5 filesystem response

[Run38137269848 / job114463594296](https://github.com/jappyjan/bobs-factory/actions/runs/38137269848/job/114463594296)
completed SUCCESS at `834088bcd4406dc2b0b5950d022a5a8b72134d57`.
Artifact `11702185760` is the original 183507-byte ZIP, SHA-256
`1a93e40dc9e915311133650bf33a3ceb9d7585ca1bc02aad904e23931c6938f8`, matching
the official provider digest. Every one of the **94** original members is retained
byte-for-byte under `raw/` with a `.raw` suffix; [inventory.json](inventory.json)
records each original name, size and hash. Provider run/job/artifact metadata and
the exact job log are retained separately. No runtime binary is duplicated here.

[inspect_receipts.py](inspect_receipts.py) checks provider/ZIP identities, every
member/copy, all eight receipts and helper hashes against Git source834. Its
[derived inspection](inspection.json.raw) confirms main `passed:true`,
`cleanup:true`, no survivors, seven assertions, 11916ms crash recovery, exact-unit
start-limit rejection and failed/no-PID/no-job/NRestarts4 state stable for10659ms.
All six INSTALL/MANAGER/HEALTHY SIGINT/SIGTERM outcomes and the seventh outer
START-deadline outcome pass. Their receipts remain `passed:false`, `cleanup:true`,
exit130/143, no survivors or retained backups; applicable cases prove the actual
manager descendant boundary and `lateMutation:false`. Timeout retains its primary
error. Diagnostics are pre-teardown observations; final cleanup relies on the
executed assertions and receipts. This native job did not force unexpected fixture
death, so it does **not** resolve the review5 filesystem P2 or prove the new fallback.

Frozen runtime remains source `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version
`1.0.0-nightly.20261010.21`, digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`, native
run38086228778/artifact11682662326, archive
d75afb47d49de95e87832c9eb987277375de8d112d794e041534883dda7b6c62.
The earlier [exact482 evidence](../2026-10-11-service-round4/README.md), its ZIP/all94
files and all historical evidence remain unchanged and separately bound.

## Review5 remaining P2 — Taskbot116 comment1304

The independent safe repro SIGKILLed a directly spawned fixture while using a
private mocked systemctl. At834, units stopped but the supervisor marked cleanup
true and deleted its registry while the fixture home/state still existed. This was
an acceptance-supervisor defect; no production runtime defect is inferred.

The supervisor now allocates the private temporary root **before** child execution,
keeps its canonical path/device/inode/owner/birth identity in memory, and persists
`filesystem.json` beside exact unit/group records. The child uses that bound root.
After draining processes and proving native cleanup, removal checks the provider's
canonical temporary parent, direct private directory, unchanged identity and owner,
manifest binding, and an external retained receipt (including symlink resolution).
It removes only that tree and descendant links themselves; linked targets survive.
Cooperative cleanup uses the same checks, and the supervisor verifies absence too.
Filesystem or ownership errors keep `cleanup:false`, the closed registry and its
reported path, and the original SIGKILL/nonPASS plus manager/fixture errors. A manager
failure prevents filesystem deletion. No unowned home or credential path is removed.

The eight safe mocked-manager regression cases use absent UUID units, private
fixture/evidence directories and a child that exits or SIGKILLs itself. They never
write a native definition or invoke a host manager. Success proves actual home/state
removal plus unowned and dangling symlink target preservation. Failure cases cover
manager errors, root symlinks, inode replacement, a forged manifest naming a separate
private directory with the same temporary-name prefix, actual read-only-state removal
failure, and a retained receipt symlink into the fixture. They assert original SIGKILL,
nonPASS, cleanup errors and retained registry/state/evidence as applicable.

Repro command: `node --test --test-name-pattern='native cleanup' docs/distribution/acceptance/owned-fixture.test.mjs`.
Against the original834 supervisor the same behavioral cases fail **7/8**, retaining
the original manager-error protection. [Before](regression-before.log.raw) and
[after](regression-after.log.raw) logs are retained. All **27/27** focused checks pass:
`node --test docs/distribution/acceptance/owned-cleanup.test.mjs docs/distribution/acceptance/service-protocol.test.mjs docs/distribution/acceptance/owned-fixture.test.mjs`.
Existing real-signal, deadline, delayed-fork/group identity and exact manager error
checks remain intact. Syntax, Biome, workspace build/typecheck and normal commit
hooks are required before push. F1 is inapplicable to this acceptance-only tooling
and evidence delta; no F1 report or product/runtime change is introduced.

The new push triggers the owned service workflow and Node22/24 CI once, without
dispatch, watch or polling. Root owns fresh review6 against the original service
brief and cumulative findings; this response does not claim independent clearance.
Exact834 native receipts remain834 receipts, not new-head acceptance. No full native
or signed23 rerun, host service/home/reboot, credential/provider, physical UI/auth,
license/relink/trust/signing, release/merge or ticket-status operation occurs.
Minimums remain macOS15 and Ubuntu24.04/glibc2.39 ARM64+x64; observed runners do not
establish every minimum-host image. Taskbot116/122/124 pickup, second-machine84 and
GitGuardian38083768/38084076 operator gates remain separate and unchanged.
