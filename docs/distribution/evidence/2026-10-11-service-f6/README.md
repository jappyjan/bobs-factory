# Exactf6 service evidence and review6 remaining-P2 response

[Run38138356861 / job114466824699](https://github.com/jappyjan/bobs-factory/actions/runs/38138356861/job/114466824699)
completed SUCCESS at `f6f41bc6446ba1d84c7b661ca585920892ccda21`, attempt1.
Artifact11701878395 is the official 182161-byte ZIP, SHA-256
`c8c23aad06a62248cbd24b977d10971e10054b3e375a1229e6b6dab5214ddd89`.
All94 original members are retained byte-for-byte under `raw/`; [inventory.json](inventory.json)
records original names/sizes/hashes. Provider metadata, exact job log and
[Node CI38138360041](https://github.com/jappyjan/bobs-factory/actions/runs/38138360041)
completed-success metadata remain separate raw files. Retrieval was bounded, without polling.

[inspect_receipts.py](inspect_receipts.py) checks the official digest, all94 original
members/copies, eight receipts and recorded helper hashes against Git sourcef6.
[inspection.json.raw](inspection.json.raw) confirms mainPASS, cleanup/no survivors,
seven assertions, 11289ms crash recovery and exact-unit start-limit journal rejection
with failed/no-PID/no-job/NRestarts4 state stable10546ms. All six INSTALL/MANAGER/HEALTHY
SIGINT/SIGTERM cases plus the actual outer START deadline pass; cancellation receipts
stay nonPASS, exit130/143, cleanup/no survivors, no errors/backups/late mutation.
The deadline preserves its primary error. The provider ran the existing27 tests.
These are **f6 results**, not validation of the correction below; native false-claim
and unexpected-death paths remain safe-mock validated.

Production remains frozen source `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version
`1.0.0-nightly.20261010.21`, digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`, native
run38086228778/artifact11682662326 and runtime archive SHA-256
`d75afb47d49de95e87832c9eb987277375de8d112d794e041534883dda7b6c62`.
[Exact834](../2026-10-11-service-834/README.md), exact482, db933 and all historical
evidence retain their original bytes and generating identities.

## Review6 P2 — Taskbot116 comment1313

At f6, a child writing `{passed:true,cleanup:true,survivors:[]}` and exiting0 skipped
independent native reconciliation. Its tree and registry were removed while the
mock registered unit remained active, with zero manager calls. The prior SIGKILL/
filesystem finding was independently cleared; this issue concerns successful exit.

Every terminal path now awaits child completion and the final registered-group
drain, then independently reconciles exact units/jobs and checks terminal state again
after reload. Escalation closes registration and drains owned groups, then uses this
same final native proof after child completion. Only successful group/native proof
permits identity-bound filesystem cleanup and registry deletion. A cleanup:true
claim cannot skip verification. NonPASS and original work/exit/signal/deadline errors
remain primary. Manager/group/receipt/manifest/filesystem errors retain cleanup:false,
state and closed registry identity evidence with its reported path. Invalid/symlinked
manifests, invalid unit identities and changed filesystem records cannot trigger
manager mutations. Missing/malformed receipts cannot bypass finalization. A deadline
before the first child receipt may publish the supervisor's initial FAIL receipt.

Repro: `node --test --test-name-pattern='child cleanup claim' docs/distribution/acceptance/owned-fixture.test.mjs`.
The initial12 cases against untouched f6 produced **7 failures** ([before](regression-before.log.raw)).
All27 existing plus19 new checks now pass, **46/46** ([after](regression-after.log.raw)).
Cases cover verified childPASS/native removal; active units/queued jobs/post-reload
jobs; permission/query errors; exit7/SIGINT/SIGTERM and combined exit/signal-plus-manager
errors; forced deadline/grace; missing/malformed receipts; manifest symlink/parse/unit
refusals; filesystem-record and group-record compromise. Refusals retain state and
registry. Existing unexpected-death, filesystem/symlink, real-signal, delayed-descendant
and start-identity checks remain intact. Tests use absent UUID units, private mocked
systemctl and supervisor-owned temporary trees; no native definitions or host manager.

F1 is inapplicable to acceptance tooling/docs/evidence. Syntax, Biome and normal
lint-staged/workspace build/typecheck hooks validate this correction. One PR91 push
triggers the existing owned service run and Node22/24 CI, without manual dispatch.
Root owns fresh independent review7 with the original brief, cumulative findings,
responses, exact new tip and eventual provider artifact. No independent clearance
or overall product/release claim is made here.

Taskbot116/122/124 statuses, separate PR92 work, macOS15 and Ubuntu24.04/glibc2.39
ARM64+x64 minimums, second-machine84, provider/native credentials/physical auth,
login/logout/reboot/lingering, minimum-host, trust/signing/licensing/relink/publication/
catalog and GitGuardian38083768/38084076 operator gates remain unchanged. No production
home/services/credentials, full native four-target build, signed23 rerun, signing,
release, merge or closure operation occurred.
