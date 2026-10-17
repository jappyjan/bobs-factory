# Automatic nightly CI

The hourly `release-channel.yml` poll retains the changed-main and six-hour
eligibility checks. Manual nightly dispatches can explicitly set `skip_cooldown=true`
to skip only the six-hour delay. The frozen candidate records the choice, and the
publisher verifies the original manual workflow run before honoring it; retries
retain that choice. See [manual override usage](PUBLIC_RELEASES.md#manual-nightly-cooldown-override).
An eligible nightly now runs the existing four native jobs,
then the existing desktop matrix using those same native artifacts, plus current
unit/integration tests and owned mocked delivery workflows. It does not rebuild
another native matrix for desktop.

Only candidate freezing is serialized. Native builds, desktop packaging and
checks for different frozen candidates may overlap, so a stuck older runner
cannot hold the preparation queue indefinitely. Publication still holds the
repository-wide lock and rechecks current main, source ancestry, cooldown and
sequence eligibility before publishing the exact validated candidate.

After that run completes successfully, `release-evidence.yml` automatically
assembles candidate-bound source and evidence. `binary-release.yml` then runs its
unchanged preparation/semantic/inventory validators and publishes under the
repository publication lock only when `BOBS_FACTORY_AUTOMATIC_NIGHTLIES=enabled`.
Nightlies remain prereleases and never move stable latest. A main advance during
the workflow chain, missing checks, ambiguous provider artifacts or mismatched
source bytes blocks publication. Ineligible polls and explicit stable preparation
produce no automatic nightly evidence.

## Durable accepted source bootstrap

The reviewed bootstrap is committed in `distribution/nightly-baseline.json`.
Normal automatic preparation needs no custom repository variable, local server,
or per-nightly evidence upload. `release-evidence.yml` reads this file from the
exact candidate tooling commit.

The bootstrap pins a published nightly tag and the SHA-256 of its complete
`release.json`. Intake verifies the public release's candidate, tag, provider
asset inventory and hashes, downloads its source archive (including ordered
chunks) and receipt closure directly from GitHub Releases, and runs bounded
semantic source validation. Repository credentials never accompany public asset
downloads.

The published source retains `nightly-source-reuse.json`, its independently
accepted original candidate and material inventory. Intake recovers every
original source/object/license/instruction/build/log member and verifies its
**original** size and hash. Derived instructions and logs are unwrapped; original
build metadata is restored only if its serialized bytes match the retained hash.
Original gate receipts and the complete original receipt archive must also match
their pinned hashes and candidate. Missing or changed inputs fail closed. This
recovers accepted member bytes from a durable published container; it does not
recreate or relabel the expired original tar/gzip container or accept new review
claims. The acceptance text and historical limitations remain unchanged.

The accepted baseline commit must be an ancestor of current main. Except for exact reviewed dependency coverage below, all package
dependency and license declarations, lockfile, workspace policy, maintained
runtime notices, desktop LICENSE/NOTICE and the shipped npm launcher LICENSE
must remain unchanged. App and package version changes are allowed; changed
Bun, Electron, dependency or license inputs still require independently reviewed
source material and a reviewed update to this committed bootstrap. Exact
removal-only dependency changes may instead have a committed `dependencyReviews`
entry: it binds the accepted baseline and reviewed ancestor commit, reviewer,
source-coverage scope, and before/after SHA-256 of each complete changed input.
Only package declarations and the lockfile are eligible. Reuse requires only
deletions, unchanged remaining dependency declarations, and exact reviewed bytes;
unreviewed additions, changed retained versions/integrities, maintained licenses
and workspace policy still fail. The original source/receipt baseline stays sealed,
and each applied removal review is retained in nightly provenance. This covers
the API-key migration's removed WebAuthn packages without a new source, object,
relink or legal-review claim. Dependency coverage is checked before downloading
the retained source archive.

A schema-2 `dependencyReviews` reference can cover an independently reviewed
frontend JavaScript/type dependency addition. It pins the complete review file,
reviewed ancestor and before/after manifest and lockfile hashes. Every newly
added package must be enumerated with its exact lockfile SHA-512, official npm
archive URL, size/SHA-256, package metadata and full upstream license texts. The
supported grants are MIT, ISC and BSD-3-Clause. Retained package blocks and direct
pins cannot change; additions are limited to the edge-worker's development
dependencies. Native binaries, Wasm and install hooks are rejected. Native runtime,
Electron, workspace policy and maintained license inputs retain their existing
closed checks.

CI downloads and inspects every reviewed archive without extracting or executing
it, then carries those exact source archives into the new source/rebuild inventory.
A separately pinned upstream notice for an existing package may accompany the
review when its npm archive omits that notice; its full text and immutable source
revision are retained too. Actual browser, service-worker and CSS package inputs
are measured during the web build and included in the binary's full notice
inventory. Historical native objects/relink receipts stay sealed and keep their
original scope; no new legal opinion or native relink is claimed. The Recipes
review and its measured checks are recorded in
[the dependency review](dependency-reviews/2026-10-16-recipes.md).

The pinned release must remain retained; deleting or changing it blocks publication.

Consumers only download the ordinary release binary or desktop installer. These
source and validation assets are publisher inputs, not custom installation
requirements.

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
committed bootstrap, rollout activation, fresh candidate and publication.

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
