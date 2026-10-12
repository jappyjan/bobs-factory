# Automatic nightly CI

The hourly `release-channel.yml` poll retains the changed-main and six-hour
eligibility checks. An eligible nightly now runs the existing four native jobs,
then the existing desktop matrix using those same native artifacts, plus current
unit/integration tests and owned mocked delivery workflows. It does not rebuild
another native matrix for desktop.

After that run completes successfully, `release-evidence.yml` automatically
assembles candidate-bound source and evidence. `binary-release.yml` then runs its
unchanged preparation/semantic/inventory validators and publishes under the
repository publication lock only when `BOBS_FACTORY_AUTOMATIC_NIGHTLIES=enabled`.
Nightlies remain prereleases and never move stable latest. A main advance during
the workflow chain, missing checks, ambiguous provider artifacts or mismatched
source bytes blocks publication. Ineligible polls and explicit stable preparation
produce no automatic nightly evidence.

## One accepted source bootstrap

The coordinator must configure **one** repository variable,
`BOBS_FACTORY_NIGHTLY_BASELINE_JSON`, after independently accepting and hosting the
retained source/rebuild material and scoped gate receipts. No per-nightly evidence
envelope or physical Mac review is required. Its value has this shape (placeholder
hashes/URLs are not deployable input):

```json
{
  "schemaVersion": 1,
  "acceptedBy": "operator who accepted these exact inputs and reuse scopes",
  "candidate": { "candidate": "complete original frozen candidate object", "digest": "original digest" },
  "source": {
    "file": "source-rebuild.tar.gz",
    "url": "https://officially-retained-storage/source-rebuild.tar.gz",
    "size": 4151718787,
    "sha256": "exact accepted source archive hash"
  },
  "receiptArchive": {
    "file": "validation-receipts.tar.gz",
    "url": "https://officially-retained-storage/validation-receipts.tar.gz",
    "size": 1,
    "sha256": "actual hash of complete original receipt closure"
  },
  "receipts": {
    "reviewedCandidate": { "file": "review.json", "url": "https://officially-retained-storage/review.json", "size": 1, "sha256": "actual hash" },
    "fullPayloadF1": { "file": "f1.json", "url": "https://officially-retained-storage/f1.json", "size": 1, "sha256": "actual hash" },
    "migrationPreservation": { "file": "migration.json", "url": "https://officially-retained-storage/migration.json", "size": 1, "sha256": "actual hash" },
    "licensingAndSource": { "file": "source-license.json", "url": "https://officially-retained-storage/source-license.json", "size": 1, "sha256": "actual hash" }
  }
}
```

Use the full original candidate JSON, measured receipt and complete original receipt-archive sizes and SHA-256s, and
actual operator-accepted receipts covering native **and desktop** dependency/source
redistribution and the recorded F1/migration/Mac reuse scopes. Original failed or
unknown observations remain part of those receipts. Acceptance of this variable
explicitly authorizes the following nightly reuse policy; it is not inferred from
an arbitrary nested manifest or a newly written `passed` label.

Every input is downloaded over HTTPS without forwarding repository credentials,
and checked against its pinned size/hash. The source archive passes the existing
bounded semantic intake. The baseline commit must be an ancestor of current main.
All package dependency and license declarations, lockfile, workspace policy,
maintained runtime notices, desktop LICENSE/NOTICE and the shipped npm launcher
LICENSE must remain unchanged. App changes and package version
changes are allowed; new/changed dependencies, Bun, Electron or license material
fail with a request to update this one accepted baseline.

For each fresh canonical native artifact, CI retrieves the pinned official Bun
base, checks its hash against the accepted source/object material, and verifies
**all** executable bytes against Bun 1.4.2's permitted ELF/Mach-O payload/signature
transformations. A runtime mismatch refuses reuse. Old compiler/object/relink
observations retain their original identities. New source assembly includes the
full current Git source and tooling, current native notices and provider records,
and the exact new candidate/version. No new relink or legal review is claimed.

Nightly gate receipts explicitly say `CI-derived-nightly`. Reviewed-candidate
scope means exact main push CI success plus the accepted baseline, not a new human
review each night. Full-payload/state-preservation scope combines retained accepted
observations with current real tests and mocked localhost, Linear, workflow,
update and recovery checks. Native/desktop scopes come from the actual successful
provider jobs, downloaded hashes and raw receipts. Mac physical trust and ordinary
DMG drag/drop are not claimed as newly exercised; Linux complete-app update and
rollback use the existing native fixture. No live provider/inference is a gate.

Stable remains explicit version/promotion, manually supplied reviewed evidence,
and approval of the exact prepared asset digest. This CI policy does not authorize
stable publication or activate automatic nightlies. The coordinator owns the
bootstrap variable, rollout activation, fresh candidate and publication.

The desktop upload retains its `desktop/` and `runtime/` member directories.
Intake reads metadata, receipts and installers from `desktop/` and verifies the
`runtime/` archive against the canonical native bytes. It archives only the three
notice files actually shipped by the five-member native bundle. DMG/AppImage rows
remain the four supported desktop targets; Linux DEBs travel in
`desktop.additionalAssets` and the complete generic `manifest.assets` inventory.
Their source sizes/hashes and safe names are checked by preparation, without
making DEBs update payloads or additional targets.

## Transport recovery

Prepared evidence envelopes may omit the duplicate root source monolith only
when their root/nested candidates and evidence match the operator's frozen
candidate and verified build run, and an available schema-2 manifest inventories
complete ordered source chunks. Intake reconstructs exclusively into its owned
temporary directory and checks chunk/whole hashes and sizes before copying it
exclusively into the output. The ordinary semantic/gate/full-prepared validators
still run. Legacy monolithic envelopes remain supported; limits are unchanged.

Artifact downloads keep their transport ZIP outside restored output and remove it
on success or failure. Newly retained prepared artifacts can therefore be restored
again without an `incoming.zip` inventory member. Old malformed artifacts containing
that member still fail safely; do not repack them to claim provider provenance.
