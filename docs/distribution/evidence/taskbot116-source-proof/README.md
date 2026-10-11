# Taskbot 116 source proof (2026-10-11)

This folder preserves compact source-acquisition and static-binary evidence for
[PR #91](https://github.com/jappyjan/bobs-factory/pull/91). It does not record
release or licensing approval. The original research inputs remain outside Git at
`/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs`; those
paths are local evidence references and do not assert public or future availability.
No source archive, native binary, linker cache, map, or large source inventory is
copied into this repository.

## Exact source acquired

The official `oven-sh/WebKit` source was fetched at commit
`2e2aa2290fac856d6f451ceacb58f7f5b44dd057` (tree
`01e7ea36e5a23bf0206724ed83c594a2eaec95ed`). The complete archive
`WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057.tar.gz` is 1,993,738,581 bytes,
SHA-256 `108dd98cc15bf43debc753cfb597b5635bd936855da2bb48bf0bcacc46881f7d`.
Independent comparison covered 466,297 Git file/symlink entries, 405,295 distinct
blobs, file modes and symlink targets. The archive contains 489,044 ordinary
entries, 5,474,279,499 regular-file bytes and 35 symlinks. The unchanged bounded
intake accepted it with 489,846 headers and 5,851,248,128 expanded bytes, within
the 500,000-header and 16-GiB expanded limits. The original source inventory and
full archive remain in the external research directory; their hashes are recorded
in `RESEARCH_EVIDENCE_INDEX.json.raw`.

## Static candidate binding

The source research is tied to frozen candidate source
`b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`, Bun
`1.4.2` at `744846f844374847c902b5e7fd59b4342a51ef99`. All four provider artifacts,
archive inventories, payloads and base runtime identities were hash-verified.
Pinned ELF/Mach-O format rules were applied by static Python inspection to
reconstruct the candidate executable bytes from the actual published base runtime
and bounded candidate payload. Every byte in all four candidate executables matches
the reconstruction, with no arbitrary comparison masks. The retained bindings are:

- Linux x64: `44e32d1894e912072948379210eb1f6e30c688be8aeeee7f8b2d21e27b50caa`
- Linux ARM64: `f211479c82733e2c466e5f80ef7f8ffef77b305aafb069e4907c85a2d935a6f8`
- macOS x64: `087ee6c64f3c53a499d0ad88b102a8cae97e2f2a0bea2f10a8ddf29f644d4843`
- macOS ARM64: `a41b8e58c4cd15e44690c9c245a9600e4d8d92f9bb8d6191634c13341de2dcdc`
  (all 100,853,024 pre-signature bytes; regenerated signature details are recorded
  separately in `BASE_RUNTIME_BYTE_BINDING.json.raw`).

This is runtime byte correspondence, not evidence that a signature is trusted or
installable. In particular, the retained macOS x64 executable has an invalid
Apple signature: 58 of 16,792 code-page hashes mismatch after candidate changes.
The actual signing invocation was not observed. No executable was run, compiled,
linked or signed as part of the static comparison.

Actual WebKit libraries, four profile/map inputs and order files, all eight
application archives, provider download manifests, and preserved cache inventories
are described in the copied manifests. The actual maps identify link inputs, but
the exact expanded link command/response file, resolved build configuration,
compiler micro-version and complete sysroot/CRT byte identities are not present.
The existing record called `LINK_MAP_INPUT_CLOSURE.json.raw` is not a native relink
receipt. Modified-library relink, complete source/dependency/license review, and a
candidate-bound `licensingAndSource` acceptance remain unproven. Do not assemble or
mark schema-2 candidate source materials accepted from this research alone.

The first-release host decision is macOS 15 and Ubuntu 24.04/glibc 2.39 on ARM64
and x64. Observed CI hosts were macOS 15.7.9 and Ubuntu 24.04.5; this does not prove
macOS 15.0 or all minimum-host variants.

## Independent review and preserved files

`independent-review/REVIEW_RECORD.json.raw` is an unchanged copy of the read-only
review record (SHA-256
`ab81758098d84347ec0897c0c5a3abd7a3151d27d79df3afc9ace1a22ef834d4`). It reports
CLEAR for the concrete research claims, with zero actionable findings in that
scope. It reviewed the source research while PR #91 was at
`c3cc8644ac34c53b185e6b8598966fcf366497ca`; it is not a review of this later docs
commit or a release/source/license acceptance. Its limits remain controlling.

The coordinator report, evidence index, source/provider manifests, candidate
binding records, independent scripts and their result records are copied byte for
byte. `COPIED_EVIDENCE_SHA256SUMS.txt` verifies all other files in this folder.
The source-input report hash is
`e4d89774f889ad9eff03a2a52e09163a359f56c18cda1e1ff06c4345e2c31b06`; the
source-input index hash is
`674f13dac1e686c1524a9541d032acd5c8db78d3d4245cd0e05d8d220153f9cc`.
`RESEARCH_EVIDENCE_INDEX.json.raw` retains source-side size/hash references for the
research set; the 85-MiB WebKit JSONL inventory, 20-MiB object-size listing, large
provider outputs, source archive and binaries stay outside Git. The independent
scripts preserve their original bytes and paths, including their original absolute
input-root assumptions. To rerun them, first provide the same external inputs at
the recorded root, satisfy any listed provider/API prerequisites, and review each
script's source comments; the copies are not relocated wrappers.

At reviewed commit `d5cde18eab21c01c23b90c4e118d6922094c720d`, this folder retained
50 compact files totaling 2,159,210 bytes (about 2.1 MiB). The round 4 storage
correction preserves every immutable research copy byte-for-byte and adds
[RETENTION_INDEX.json](RETENTION_INDEX.json), mapping all original paths, sizes
and hashes to their retained paths. Research JSON and the copied module use
`.json.raw` / `.mjs.raw` extensions so normal maintained-code linting does not
rewrite provider/reviewer bytes or reject the 1.1-MiB ar inventory. The original
research index and report retain their source-side paths; resolve repository
copies through this mapping. The maintained README and checksum inventory are
updated separately; the index also retains their reviewed baseline hashes.

To verify the repository copies, run from this folder:

```sh
shasum -a 256 -c COPIED_EVIDENCE_SHA256SUMS.txt
```

For module reproduction, read the `.mjs.raw` copy first, then copy it to a fresh
owned directory as `intake_audit.mjs` and run `node /absolute/fresh/intake_audit.mjs`
with the recorded external inputs present. The module writes its result beside
itself, so never run it in this retained evidence folder. Python research scripts
also retain their original absolute inputs and output behavior; reproduce from
a fresh owned directory, without overwriting retained results. No original
external archive or research file is renamed or modified by this storage fix.
Historical HTTP 422
records, the prior 101 + 53 + 56 raw evidence files, all 95 preserved research
files, and the original f48/c3 service-failure evidence are not rewritten by this
delta.
