# Public binary installation and publication

The supported bootstrap is downloaded over the documented HTTPS Pages endpoint:

```sh
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh
```

The bootstrap comes from that HTTPS endpoint or a reviewed immutable checkout.
Public releases use GitHub HTTPS plus candidate-bound SHA-256 and byte-size
inventories. Downloads must match that inventory before the verifier runs or an
installation changes. This checks integrity and consistency with the GitHub
repository; it does not authenticate a publisher independently of GitHub.
No Apple Developer account, Developer ID, notarization, stapling, publisher
manifest signature or signing infrastructure is required. Standard macOS/Linux
tools and curl are required; Node, Bun, npm, GitHub login and sudo are not
installer prerequisites. Native credential stores remain host-owned.

Default installation selects verified stable, with a clearly labeled verified
beta fallback until the first stable exists. Nightly is opt-in:

```sh
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh -s -- --channel nightly
```

Use `--version VERSION --channel stable|nightly` for an immutable exact version.
The release version must match the requested channel. Explicit `--channel stable`
rejects beta; use the default channel (optionally with `--version VERSION`) for
the inventoried beta compatibility fallback. `--prefix /absolute/path`
and `--no-modify-path` retain their existing meaning. Installation keeps owned
immutable versions and an atomic executable link, preserves the prior rollback
link, and refuses foreign executables or changed installed bytes. Shell settings
are backed up before PATH changes; managed profiles are left to their owner.
Installation and launch remain separate. Factory state, workflows/results,
checkpoints, gates, worktrees, native session IDs and host credentials are never
migrated or modified by release tooling. [Per-instance updates](UPDATES.md),
[user-service lifecycle](SERVICES.md), [desktop packages and app updates](DESKTOP.md)
and [package-manager entry points](PACKAGE_ENTRY_POINTS.md) document the integrated
delivery mechanisms. Their native acceptance and publication gates remain separate
from installer integrity; installation never silently enrolls a service.

## Frozen candidates and channels

`candidate.json` contains a schema-1 candidate record and its SHA-256 digest.
The digest covers canonical JSON with recursively sorted object keys: product,
repository, channel, version/tag, full runtime source SHA, committed package
version, frozen workflow/tooling SHA, pinned Bun/Node recipe and all four native
targets. Stable also records its verified nightly origin, manifest digest and
provider release ID. Build run/attempt and provider artifact IDs are recorded in
`build-provenance.json` after building; they never regenerate candidate identity.

`release-channel.yml` polls hourly and supports manual preparation. It resolves
main once for nightly. Stable preparation requires the operator to supply an
exact published `nightly_tag` in the workflow, or `--nightly-tag vVERSION` to
`prepare-release-candidate.mjs`. The selected nightly must have a complete validated
release; an older verified nightly remains selectable after a newer one appears.
Stable freezes that nightly's source even if main or nightly advances afterward. Stable bytes embed the requested stable version and require
new native builds and byte-bound validation. Source-only assessments can be
reused only with a reviewed explanation of why they still apply.

A nightly version is `CORE-nightly.YYYYMMDD.SEQUENCE`. CORE is the committed
package core; UTC date comes from the originating workflow run's creation time;
SEQUENCE is its globally unique, increasing GitHub run ID. The frozen artifact is
restored on retries. Failed attempts retain their sequence, while later starts
reserve new run IDs. Ordering uses sequence across core changes. Reusing an
older sequence blocks preparation/publication, including manual dispatch.
Nightly requires changed main, a descendant of the last verified published
nightly, and normally at least six hours since successful publication. The first nightly
has no cooldown. Failed preparation does not reset the clock. A frozen candidate
that no longer matches main skips publication. Eligibility is checked inside the
repository publication lock and again immediately before making a draft public.
Nightly preparation and publication block if the highest published nightly sequence
cannot be verified, including with incomplete
assets. They never substitute an older verified nightly to establish source,
cooldown or sequence eligibility. Refresh trusted release tooling or repair the
release evidence before retrying.

### Manual nightly cooldown override

In Actions → **Freeze eligible nightly or stable promotion** → **Run workflow**,
choose `channel=nightly` and enable **Skip nightly cooldown**. It defaults to off.
The equivalent CLI dispatch is:

```sh
gh workflow run release-channel.yml --ref main -f channel=nightly -F skip_cooldown=true
```

This starts the normal nightly pipeline immediately without the six-hour delay.
The optional `candidate.skipCooldown: true` is part of the frozen candidate digest
and publication plan, so retries and the downstream publisher retain that exact
choice. Retries cannot add or remove the override; start a new manual request to
change it. The publisher verifies the original sequence allocation came from the
same repository's manual `release-channel.yml` run at the frozen tooling SHA,
including when resuming retained prepared bytes.

Scheduled nightlies keep the cooldown. Stable/beta requests reject the option.
Changed/descendant main, valid publication history/time, increasing sequence,
current-main checks, rollout activation, all native/desktop/evidence gates,
publication locking and stable-channel separation still apply. The option skips
only the elapsed-time check, not build or validation time.

### Explicit beta preparation through CI

To prepare `v1.0.1-beta`, dispatch `release-channel.yml` on the reviewed `main`
revision with `channel=beta` and `version=1.0.1-beta`. Beta freezes current main
once and embeds that exact version; it does not allocate a nightly sequence or
promote a nightly. Retries restore the retained candidate and reject changed
versions. Only manual dispatch can prepare beta.

The beta job runs the same four-target CLI/desktop matrix and current mocked
full-payload checks as nightly. `release-evidence.yml` imports the accepted pinned
`BOBS_FACTORY_NIGHTLY_BASELINE_JSON`, preserves historical source/receipt
observations and combines them with the actual beta candidate's native receipts
and check logs. Missing evidence, changed dependency/license inputs, failed native
validation or non-green exact main CI block preparation. No paid provider tests
are added.

Successful evidence triggers `binary-release.yml` in preparation mode. Review its
retained `bobs-factory-prepared-release-DIGEST` artifact and `publication-plan.json`.
Publish by dispatching that workflow from the frozen tooling revision with the
exact `prepared_artifact_id`, `publish=true`, and `approved_assets_digest` from the
reviewed plan. Approval binds both candidate and asset inventory. Beta is a GitHub
prerelease, never moves stable latest, and uses the repository publication lock
and existing immutable tag/asset recovery checks. Automatic-nightly rollout does
not authorize beta publication.

Website synchronization renders direct DMG, AppImage and DEB links only from the
complete verified published inventory. Before a stable release exists, the default
installer and website download selection may use the verified beta; explicit
`--channel stable` still rejects beta. Nightly remains a separate opt-in selection.

The four targets are `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.
Windows and musl are unsupported. Minimum OS/libc/CPU claims require observed
native execution; cross-compilation is insufficient.

## Release integrity contract and discovery

New `release.json` assets use schema 2 and canonical two-space JSON. They bind
product/repository, availability, channel/version/tag, source commit, actual
build run, frozen candidate digest and tooling SHA to a complete `assets` inventory
of archives, installers, source/rebuild transport, candidate, evidence, validation
receipts and provenance. Every record has its exact filename, SHA-256 and size.
The manifest itself is outside its inventory to avoid a circular hash; GitHub's
uploaded asset digest and size bind its downloaded bytes. New publication emits
no `.sig` or `.key-id` files. Historical signature sidecars are retained and may
be checked as ordinary hash-bound bytes, without a verified-signature claim.

Pages checks manifest/candidate identity, provider tag/source and the complete
remote inventory before producing stable/default and nightly pointers together.
`/releases/latest.json` and `/releases/stable.json` share the stable/beta selection;
`/releases/nightly.json` is independent. Pointers preserve exact manifest bytes.
Drafts and incomplete/conflicting releases are excluded. A transport or checksum
failure aborts the website build, preserving prior deployed pointers. Empty
channels remain unavailable. Pagination fails above 10,000 entries.

Synchronization uses a read-only GitHub token and checks each channel until a
usable target is found. Publication ordering still uses the complete published
provider history, including rejected releases: incomplete metadata cannot erase
newer stable releases or bypass nightly eligibility. The public installer and
updaters download directly over HTTPS and reject wrong channel/version/source,
size, hash and candidate identity before installation. SHA-256 alone cannot
detect coordinated replacement of both manifest and payload by a compromised
GitHub account. No stronger publisher-authentication guarantee is claimed.

Nix takes a reviewed immutable local `releaseManifest` and fixes archive downloads
to its versioned GitHub URL and SHA-256. Legacy beta additionally takes the reviewed
`releaseAttestation` complete inventory. Evaluation never fetches mutable latest,
and Nix continues to own its installations.

## Complete source transport

Local evidence and source-material intake retain the complete `source-rebuild.tar.gz`
with its exact size and SHA-256. GitHub requires every individual release asset to
be under 2 GiB (2,147,483,648 bytes, exclusive). Preparation keeps the existing
single-file representation for archives below that limit. Larger archives use
an optional schema-2 manifest extension:

- `source` remains `{file: "source-rebuild.tar.gz", sha256, size}` for the complete
  reconstructed archive. It is a reconstruction identity, rather than an uploaded
  monolith, when `sourceTransport` is present.
- `sourceTransport` is `{schemaVersion: 1, type: "chunks", chunkSize, chunks}`.
  Production preparation uses `chunkSize: 1073741824` (1 GiB). Each ordered chunk
  record contains `order` (one-based), `file`, `size` and `sha256`.
- Filenames are exactly `source-rebuild.tar.gz.part0001`, `.part0002`, and so on.
  The array order and explicit `order` must agree. Every chunk except the final
  one has exactly `chunkSize` bytes; the final one has exactly the remainder.
  The count must equal `ceil(source.size / chunkSize)`. All chunks are positive
  and at most 1 GiB; the complete compressed archive retains the existing 8 GiB
  intake ceiling. The complete release must fit GitHub's 1,000-asset count limit.
- The `assets` inventory contains those exact chunk records and excludes the monolith.
  Missing, duplicate, reordered, extra or mismatched source records fail validation.
  The exact manifest snapshot binds reconstruction. Schema-1 beta
  cannot carry this extension; its original manifest, inventory and receipt
  digests remain untouched. Schema-2 single-file releases remain readable.

`source-transport.mjs` owns this policy, deterministic splitting and bounded
reconstruction. Recovery opens only exact regular files, refuses links and
special files, never overwrites an existing output, and concatenates in inventoried
order with a 1 MiB buffer into an owned temporary directory. It verifies each
chunk and the exact total archive size/hash before the existing unchanged source
and release-evidence intake. The inventoried reconstruction identity must equal the
local evidence's full-archive record. Transport checks do not replace semantic
intake, licensing approval or any other release gate.

Keep the complete retained assets directory for publication recovery.
`--resume` validates and uploads the chunk inventory; it never reconstructs
or uploads a monolith as a remote asset. Matching partial draft chunks are reused,
missing draft chunks are uploaded, and unexpected/conflicting remote assets block
publication. Discovery requires the exact complete remote inventory, including
manifest bytes, for chunk releases. Missing public chunks cannot be
appended automatically. Preserve conflicting immutable state for inspection.

Publication plans and reconciliation use the inventory from the exact verified
manifest bytes. Before
emitting a plan, the publisher checks the local filename set and copies regular,
unlinked files with safe modes into a private temporary snapshot, checking every
size and hash while copying. Uploads use that snapshot through pinned file
descriptors and verify the actual streamed bytes before a release can become
public. A staging integrity failure leaves the release draft and keeps its
validated inventory in the recovery receipt. Temporary snapshot storage must
fit the complete asset set; it is removed on success, refusal and ordinary retry
failure. Changed input files never redefine publication expectations.

For offline source recovery from a complete schema-2 release, download its
exact versioned inventory and manifest into a directory, then run the
reviewed tooling:

```sh
node scripts/recover-release-source.mjs --assets /path/to/assets \
  --output /path/to/new-recovered-source
```

The output directory must not exist. The command binds the original manifest bytes,
validates the complete prepared release and unchanged semantic source intake,
then retains only the verified full archive. Failure removes only its newly owned
output. It performs no network requests, signing, publication or installation.

Changes to frozen tooling require a new reviewed candidate identity. Transporting
unchanged accepted source bytes does not authorize relabeling old candidates,
workflow runs or receipts; any evidence reuse remains independently
reviewed against the new identity.

## Historical beta

Historical schema-1 manifests and evidence remain immutable. A reviewed additive
`release-attestation.json` binds the old manifest's exact SHA-256/size and complete
validated asset inventory. `prepare-beta-attestation.mjs --assets IMMUTABLE_ASSETS
--output EMPTY_DIRECTORY --approval APPROVAL.json` validates existing native,
source and evidence gates. Approval binds `manifestSha256`, sorted inventory
`assetsDigest` and `approvedBy`. It emits only the additive inventory and never
changes archives, the original manifest or tag, or uploads anything. Publication
of that additive file remains separate. An incomplete historical beta remains
unavailable; nightly never silently replaces the stable/default channel.

## Preparation, approval and recovery

Publication is disabled by default. Do not dispatch publication, install on a
production host as part of implementation validation.

1. Freeze with `release-channel.yml`. It calls `binary-build.yml` at the same immutable
   workflow revision for native validation only. Manual builds dispatch from the
   frozen tooling ref and pass exact candidate JSON.
   The build checks out runtime source and tooling separately and uses
   `build-binary.ts --source-root SOURCE --candidate FILE --release-version VERSION`
   without editing tracked packages. Ordinary local builds still use the committed
   version. Candidate digests and run-attempt suffixes distinguish stable/nightly artifacts
   and retain previous attempts without overwriting their bytes.
2. Assemble real source/rebuild and release evidence. Use
   `build-release-source.mjs --sha SOURCE_SHA --candidate FILE --materials DIRECTORY
   --output EMPTY_DIRECTORY`; the bundle also carries candidate/recipe and exact
   tooling source. Document the version override in reviewed rebuild/relink instructions.
   Dispatch `release-evidence.yml` with candidate JSON, successful binary run ID,
   archive HTTPS URL and independently reviewed archive SHA-256. It imports receipts;
   it never invents passed or not-applicable gates. Candidate review, full-payload F1,
   migration/state preservation and licensing/source evidence must actually exist.
3. `binary-release.yml` prepares on successful evidence intake or manual dispatch.
   Preparation has read-only repository credentials. Inspect
   its `bobs-factory-prepared-release-DIGEST` artifact and `publication-plan.json`.
   Complete validation produces the exact unsigned asset digest. Local equivalent:

   ```sh
   node scripts/publish-binary-release.mjs --candidate candidate.json --run-id RUN_ID \
     --evidence /path/to/release-evidence.json --output /path/to/empty-output
   ```

4. For stable, review the prepared `publication-plan.json` and dispatch
   `binary-release.yml` with that exact retained `prepared_artifact_id`, `publish:
   true` and `approved_assets_digest`. Approval binds both the frozen candidate and
   full unsigned inventory. No sign-only phase or protected signing environment
   is required. Stable sets GitHub latest only after all gates pass.
5. The [automatic nightly CI route](NIGHTLY_CI.md) assembles actual checks and source
   material from a one-time accepted, pinned baseline; it does not require a new
   manually assembled evidence envelope per nightly. Automatic nightlies require separate rollout activation and explicit
   `BOBS_FACTORY_AUTOMATIC_NIGHTLIES=enabled`. Successful evidence intake then
   publishes eligible nightlies, still subject to explicit CI-derived nightly
   review/migration/F1/license gates and accepted baseline reuse scopes and changed-main/history checks. The six-hour delay applies unless the frozen candidate carries the verified manual override above. Manual publication has the
   same eligibility and activation requirements. Nightlies are prereleases and
   never move stable latest. Automatic entrypoint SHA must equal frozen tooling;
   if it has advanced, dispatch manually from that frozen ref and retain the
   original source and prepared bytes.

All mutations share `bobs-factory-repository-publication` concurrency; builds may
run in parallel. Never run another mutation client outside that lock. Local
publication requires infrastructure to establish the same repository lock and
set `BOBS_FACTORY_RELEASE_PUBLICATION_LOCK=repository`; the marker itself does not
implement a distributed lock. A local directory lock also serializes publishers
on the same host; an interrupted owner requires inspection before clearing it. Local preparation/dry run performs no tag, draft,
upload, dispatch, channel deployment or host installation.

Recovery uses the exact retained prepared artifact (`--resume` locally),
not a rebuild or refreshed clock. `publication-receipt.json` tracks candidate,
tag/release IDs, expected assets, completed stages and synchronization. Annotated
tags include the candidate digest and point to frozen runtime source. Matching
drafts/assets are reused; missing draft assets are uploaded. Different identities,
bytes, duplicate assets or incomplete public releases block without deletion or
overwrite. Ambiguous tag/draft/upload/publication responses are reconciled against
provider state. Already-public matching releases count as published; only unfinished
Pages synchronization is retried. The publisher explicitly dispatches `website.yml`
after publication because token-created release events may not start workflows.
A synchronization failure preserves publication success and prior deployed pointers;
retry the retained publication artifact. Partial/failed-run artifacts remain usable
for recovery only after fresh identity, integrity and full validation checks.

Artifact transport is authenticated for maintainers only. End users never receive
`GH_TOKEN`. `--artifact-zips DIRECTORY` supplies offline TARGET.zip build artifacts
whose digests must still match provider provenance. No repository token is forwarded
to temporary HTTPS artifact storage or operator-supplied evidence URLs.

## Required evidence

`release-evidence.json` has `schemaVersion: 1`, `product`, exact `version`,
`commit`, `buildRunId`, `candidateDigest` and `workflowSha`. Each validation record has a `status` and
`receipt: { file, sha256 }`, with a receipt inside the evidence directory:

- `reviewedCandidate`: `passed`.
- `fullPayloadF1`: `passed` or `not-applicable`, with the documented applicability
  assessment for the entire runtime payload since the previous release.
- `migrationPreservation`: `passed`, covering home/config and native continuation.
- `licensingAndSource`: `passed`, covering complete notices and exact runtime,
  dependency source/rebuild obligations.
- `targets[TARGET].preparedAgents`: `passed`, referencing the candidate-bound
  `prepared-agent-boundaries.json` from that target's native build. The required
  validation uses mocked agents and controlled protocols. Legacy `waived` records
  retain their `approvedBy` and scope when publishing an already verified candidate.
- `targets[TARGET].nativeHelpers`: `passed` for every target.

Native startup/dashboard/protected API/MCP/shutdown/restart receipts are retrieved
directly from each successful native binary build artifact, alongside
`native-helpers.json` and `prepared-agent-boundaries.json`. Native helper identity
and executable hash must match the verified archive. Scripted adapter boundary
checks and synthetic GitHub credentials satisfy the release's controlled test scope;
they do not claim authenticated coding-agent execution. Live provider tests are
manual-only and require explicit approval for the specific test. Releases never
require them or a recurring live-test waiver. Missing validation,
ambiguous artifacts, dirty builds, checksum mismatches or different source SHAs
block staging and publication.

The evidence `source` record names `source-rebuild.tar.gz` with SHA-256 and byte
size. The archive contains regular files/directories under `source-rebuild/`,
including `commit.txt` with the candidate SHA, `README.md` with precise rebuild
instructions, `pnpm-lock.yaml`, and the pinned runtime source
`bun-source.tar.gz`. Include the exact factory/dependency sources and any other
material identified by the licensing review; these files are a minimum inventory,
not a substitute for that review. Evidence and receipt hashes accompany the public
release so the exact approval and validation remain inspectable.

To assemble reviewed material, use `scripts/build-release-source.mjs --sha
FULL_SHA --candidate FILE --materials DIRECTORY --output EMPTY_DIRECTORY`. The input directory
contains precise reviewed rebuild/relink instructions in `README.md`, regular
source files/archives, and `source-materials.json` with `schemaVersion: 2`, exact
`commit`, `version`, `workflowSha`, `candidateDigest`, `bunVersion: "1.4.2"`,
`records`, `patches` and per-target `builds`. Each record names its `kind`, flat
`file`, HTTPS `source`, exact `revision`, byte `size` and `sha256`. Include a
`bun` record named `bun-source.tar.gz`, the exact patched `webkit` source and
any corresponding dependency/library source required by the licensing review.
Native object, build-config and actual relink-log records bind the same frozen
candidate and target. Follow the maintained
[source-material assembly and bounded intake contract](source-materials/README.md);
legacy beta source bytes and independent approval receipts remain unchanged.
The tool adds `factory-source.tar.gz`
from the exact committed Git tree, its lockfile, commit and material inventory,
then emits `source-rebuild.tar.gz` and its `source-record.json`. These integrity
checks do not establish license completeness; that remains a separate reviewed
`licensingAndSource` receipt.

Bun's [pinned license/relink instructions](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md)
identify statically linked JavaScriptCore/WebKit and TinyCC LGPL requirements.
The [pinned build source](https://github.com/oven-sh/bun/blob/bun-v1.4.2/scripts/build/deps/webkit.ts)
selects WebKit commit `2e2aa2290fac856d6f451ceacb58f7f5b44dd057`.
The Bun source archive alone is insufficient: include the patched library source
and the object/source/rebuild material required to permit relinking. Review
other bundled libraries against the exact runtime, and include dependency
notices identified by the binary's `THIRD_PARTY_NOTICES.txt`. Retain factory
Apache-2.0 attribution. The operator's proprietary Cursor installation remains
outside distributed archives.

Current release blockers described in [RELEASING.md](../../apps/cli/RELEASING.md)
remain blockers until the corresponding real evidence is supplied. No missing
coverage is marked passed by the publisher.

## Installer validation and delivered desktop assets

The native matrix also runs `scripts/smoke-public-install.mjs` against the freshly
built archive with controlled unsigned downloads. It verifies
channel/exact-version resolution, repeat installation, malformed-manifest rejection and
preservation of the existing executable when hash, size, source or target checks
fail. This does not exercise public GitHub downloads.
New prepared manifests declare `publicInstallerValidation: 1`; publication and
recovery require each target's matching `public-installer-TARGET.json` receipt,
including the frozen candidate digest and tooling SHA. Historical manifests
without this extension remain readable; their immutable assets are never rewritten.

Desktop packaging remains owned by its separate delivery. When evidence includes
`desktop: {schemaVersion: 1, artifacts: [...]}`, each item declares the same exact
version, source commit and channel, a unique target and observed
`platformRequirements`. Its `archive`, `updateMetadata` and `validation` records
carry file, size and SHA-256. Preparation copies and validates these assets;
an optional `updateArchive` record separately inventories the complete recovery
payload (macOS `.bobsapp.gz`, Linux AppImage). It is copied and verified with
the other assets, never resolved from a detached URL. `updateMetadata` binds that
payload's format/full-app fingerprint and local Mach-O signing status to the
same candidate. macOS activation accepts the hash-bound unsigned app; actual functional validation
and per-app OS permission remain separate from metadata integrity.
The validation JSON must report `product: "bobs-factory"`, `status: "passed"`,
matching version/commit/channel/target, `candidateDigest` and `workflowSha`.
All records must also match the `assets` inventory. Missing, duplicated or
altered validation receipts block discovery and stable promotion. Recovery checks
the receipt identity again. No desktop downloads are advertised until delivered.

Receipt archives use canonical USTAR headers and fixed metadata so the same receipt
bytes produce the same archive across retries on different hosts. Publication
recovery still reuses the exact retained prepared assets and never rebuilds them.
