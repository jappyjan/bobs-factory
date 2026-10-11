# Exact round 4 service CI and remaining cleanup correction

[Run 38135977321 / job 114459805179](https://github.com/jappyjan/bobs-factory/actions/runs/38135977321/job/114459805179)
completed successfully at harness `482e95cbaed55be6e4f01916b0095c77979d2fdc`.
The one completed-run read retained here supersedes the earlier pending snapshot
in Taskbot #116 comment 1283. It does not establish acceptance of the subsequent
unexpected-death correction or of the Node CI fix.

Production runtime remains `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version
`1.0.0-nightly.20261010.21`, candidate digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`.
The retained job log binds execution to frozen run `38086228778`, artifact
`11682662326`, runtime archive SHA-256
`d75afb47d49de95e87832c9eb987277375de8d112d794e041534883dda7b6c62`.
The host reports Ubuntu 24.04.5 x64; this is isolated runner user-manager evidence.

`artifact.zip` is the complete original service artifact `11700339615`, 183885
bytes, SHA-256 `ffc8269fc388f416e4e9e957a61c0a011ed8f53bef9d3b224b0f36bc3ea80e2c`,
matching the official GitHub digest. All **94** original files are retained under
`raw/`, with a `.raw` suffix added to each original filename, and no byte changes.
[inventory.json](inventory.json) records original names, retained paths, sizes and
hashes. Provider run, job and artifact metadata and the exact job log are retained.
No runtime binary or installer is copied into this folder.

[inspect_receipts.py](inspect_receipts.py) independently verifies ZIP/provider
identity, every original member/copy, all eight receipts, seven matrix outcomes,
referenced diagnostics, and eight helper hashes against the exact Git source.
Its derived output is [inspection.json.raw](inspection.json.raw).

- Main: `passed:true`, `cleanup:true`, no survivors, all seven original assertions
  completed. Crash recovery took 11797 ms. Exact-unit journal rejection proves
  start-limit exhaustion while Result remains `signal`; terminal failed state,
  MainPID/ControlPID zero, no job and NRestarts 4 stayed stable for 10524 ms.
  Remove retained the two expected definition backups and one service record;
  the fixture's cleanup assertions subsequently remove its owned temporary state.
- Initial-install and manager-mutation SIGINT/SIGTERM: each `passed:false`,
  `cleanup:true`, no survivors or retained backups, exit 130/143 respectively.
  Initial-install records actual `--user daemon-reload`; manager-mutation records
  `--user start EXACT_WORKER_UNIT`. Each has `lateMutation:false`.
- Healthy-unit SIGINT/SIGTERM: each `passed:false`, `cleanup:true`, no survivors
  or retained backups, exit 130/143 respectively.
- START-boundary outer deadline: `passed:false`, `cleanup:true`, no survivors,
  exit 143, `outerTimedOut:true`, preserved timeout error, actual exact START
  identity and `lateMutation:false`. All seven independent matrix outcomes pass.

Diagnostics are pre-teardown manager/process observations, not final snapshots.
Terminal cleanup is established by the executed harness assertions and final
receipts. Intentional cancellation receipts are not successful runtime runs.
The historical db933 main success is not reused as a482 result: round 3 artifact
`11700237374`, ZIP `eef72aa87802ffac3ad5ec1fe8197638dd73c0a4bbd7b0a92f4a57f879e7b75e`,
and all 85 original files remain separate and unchanged.

## Remaining review4 P2 response

At exact482, `owned-fixture.mjs` reconciled native units only for timeout. A fixture
SIGKILL before the deadline drained groups, skipped the native manager entirely,
then deleted the manifest despite `cleanup:false`. The independent safe repro in
Taskbot comment 1283 and three new safe regression cases reproduce this omission.
[regression-before.log.raw](regression-before.log.raw) captures all three failing
checks against the original helper. The new helper reconciles exact registered
units after unexpected failure, after exit without cleanup proof, and independently
of group cleanup failures. Successful fallback updates cleanup proof but preserves
the primary fixture failure and `passed:false`. Failed cleanup retains the closed
private registry, its manifest and group identities, with its path in both receipt
and thrown error; fixture cleanup errors and manager stderr remain visible.

The three regressions use a temporary mock `systemctl`, an absent randomly named
unit and a directly spawned fixture that SIGKILLs itself. No native definition is
written and no host manager operation runs. Cases cover unexpected SIGKILL,
manager cleanup permission failure, and normal exit without cleanup proof.
Successful cleanup deletes the private registry only after verification. Failed
cleanup preserves the manifest, original SIGKILL status/error and both fixture and
manager errors; test teardown removes only private test evidence. Existing timed
cooperative/forced nested-group checks remain required. All 22 focused checks pass
in [regression-after.log.raw](regression-after.log.raw).

Changed helper SHA-256: `owned-fixture.mjs`
`886b9dd10bdc8cd23cdac2062cbb76720246ba372c557d8e42adf769f1422dd1`;
regressions `owned-fixture.test.mjs`
`7babb81b24aa16d80495125126da0c74aa171095e8e532674a37de4d46643846`.
The old482 helper hash in the native receipts remains
`5a511cd7ad2a2ddb2b174ecb6da7fbfe5bc1f414c6d3bf23502fd3da3376c566`.
These receipts are not relabeled for the new helper. Acceptance-module syntax,
Biome, workspace build/typecheck and normal commit hooks are required before push.
F1 is inapplicable: this delta changes acceptance supervision/evidence, not product
runtime or the F1 harness. No F1 report is created. The root coordinator owns fresh
review5 and review of CI triggered once by the new service head.

No production home/service, reboot/login/logout/lingering, provider/credential,
physical authentication or signing operation occurs. Native forced-death testing
of this new fallback remains separate from the safe mock regressions. Same-PID/
nonce UI retention is covered only by the separately retained frozen desktop
receipts; this display-free service run does not exercise UI lifecycle. Native
workflow/provider continuation, second-machine #84, full minimum-host coverage,
licensing/relink/publication/catalog and signing gates remain open. Minimums stay
macOS 15 and Ubuntu 24.04/glibc 2.39 ARM64+x64; observed versions do not prove every
minimum image. Source evidence/archives remain untouched, PR92 remains separate,
and GitGuardian incidents 38083768/38084076 require operator disposition. No ticket
status, release or merge approval is changed.
