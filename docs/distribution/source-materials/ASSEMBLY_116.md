# Taskbot116 frozen .21 source/relink assembly

Actual source assembly is retained outside Git and is ready for independent technical and licensing/source review. Directory and complete archive intake passed the unchanged schema 2 validator. No `licensingAndSource` receipt or release authorization is issued here.

Implementation base: `b03297502096f63cddbea521eac31869e7c20839` in isolated branch `delivery/taskbot-116-schema2-assembly`. PR91/92 branches were untouched. PR92 subsequently merged into main `73345404451f35a1cd2c13117898792dc71c5ca9`, which was verified to contain the exact base. This branch was not rebased.

Frozen material identity: candidate `ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`, Factory/tooling `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version `1.0.0-nightly.20261010.21`. Code merges do not alter these source/runtime/object pins.

## Retained actual bytes

- Archive: `/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/schema2-assembly/output/source-rebuild.tar.gz`.
- Size: **4,123,580,131 bytes**; SHA-256 `c1ff95d783333f3422736bba5bd82e5c5e6bb637b432d9a07bcb41e0621ec8a1`.
- Flat schema 2 manifest: `/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/schema2-assembly/output/source-rebuild/source-materials.json`; 128,224 bytes, SHA-256 `0013fb39d0ab893e9adafab715cf4cfe93b540b859a2540dc6df2b8440caf7ec`.
- 80 material records totaling 4,091,185,920 bytes; 86 flat regular files including complete exact Factory/tooling Git archives, frozen candidate and lockfile.
- Exact source/size/hash/origin/revision records, builds and patches are retained byte-for-byte in [source-materials.json.raw](evidence/taskbot116-assembly/source-materials.json.raw). [source-record.json.raw](evidence/taskbot116-assembly/source-record.json.raw) identifies the assembled archive. These metadata files are small; source, objects, caches and the material archive are not committed to Git.

Complete WebKit source preserves all 466,297 exact Git file/symlink entries, with offline fsck/archive equivalence and 489,846 real tar headers (including PAX) in retained provenance. Its unchanged 1,993,738,581-byte archive SHA-256 is `108dd98cc15bf43debc753cfb597b5635bd936855da2bb48bf0bcacc46881f7d`; the validator-compatible origin is `https://github.com/oven-sh/WebKit/tree/2e2aa2290fac856d6f451ceacb58f7f5b44dd057`. Exact official Bun and TinyCC archives are included. All original research/source/native raw inputs remain untouched.

## Four target kits

Each kit contains all genuine C++ application archive members and Rust staticlib members, exact linked libraries, actual upstream profile/features/map/log records, complete source-derived link/strip graph and response recipe, pinned source controls and correct used order. Each target has candidate-bound objects, build-config, relink-log and complete official cache records. The configured source/runtime/executable digests and all input identities are in the manifest. Compiler scopes explicitly distinguish observed reconstruction from a proposed source-selected recipe.

- **darwin-arm64**: 1149 C++ / 170 Rust archive members, 3 linked libraries, 17 regular kit entries. Objects 267,413,778 bytes, SHA-256 `b9729bf5683350be95cebee61ee7964b90cfe1951ab9f034bcab076ef3e2a0b8`. Build-config SHA-256 `cfc1b7bbafddf4eb8c147529b0596083717a8a843489cd486a8b316692b17db4`. Runtime `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`; Factory executable `1a66bd81f84f7a382ded69db2b588f3ff0a69b08228695124ef834bc35cb9d10`.
- **darwin-x64**: 1173 C++ / 170 Rust archive members, 3 linked libraries, 16 regular kit entries. Objects 268,862,444 bytes, SHA-256 `216471da142faa35a7b104d9acd7429fbe5cb3bb32ce07ecc82de5d391b38848`. Build-config SHA-256 `70c10aec8fe802a670826b781c87a1ee62badda47bacd7428e919855369ad18c`. Runtime `2fa513af22ac59e03aae640cad302e73cb1ddb0f6398501e2ddccf7dcd613596`; Factory executable `087ee6c64f3c53a499d0ad88b102a8cae97e2f2a0bea2f10a8ddf29f644d4843`.
- **linux-x64**: 1172 C++ / 171 Rust archive members, 6 linked libraries, 158 regular kit entries. Objects 285,444,451 bytes, SHA-256 `69ee166de8bd19085ff635e0f826e939b06f143743eee953171220c0a7e462c9`. Build-config SHA-256 `905e6e682da39f7d8b2fcddf4b96925ed3b5f5e897b4ed3a948dcdfed04412b6`. Runtime `a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c`; Factory executable `144e32d1894e912072948379210eb1f6e30c688be8aeeee7f8b2d21e27b50caa`.
- **linux-arm64**: 1148 C++ / 171 Rust archive members, 6 linked libraries, 20 regular kit entries. Objects 283,851,143 bytes, SHA-256 `1bca79022520ef8f165a9e8b7591944e37b8a4a7d5b7bd48583d12252223adb6`. Build-config SHA-256 `e05651556d8e82b3ff660d9d0190836f5bcd40b760d6f1a70a5929d35de7672a`. Runtime `616f267a34278ff5ac282df37ffdfba1d7141f4f6926bca99af2cd6ef3ad32b1`; Factory executable `f211479c82733e2c466e5f80ef7f8ffef77b305aafb069e4907c85a2d935a6f8`.

Mac ARM and Linux x64 use the real inherited 110317 order inputs; Linux ARM uses the actually traced/relinked 110323 input; Mac x64 has no order input. The four caches retain complete generated headers/configs, with the two actual 707-command Linux compile databases. All 18 linked WebKit/ICU libraries and eight application static archives are preserved.

The graphs come from the immutable Bun generator, with explicit relocation roots, retained archive order, ThinLTO/ABI/export/wrapper flags and source controls. Rust LLVM22.1.8 `ld.lld` / `ld64.lld` is selected for newer Rust bitcode alongside clang21.1.8, following pinned config logic. ELF keeps the real llvm-objcopy debug-compression and GNU target-strip steps; Mach-O retains host-compiled stack/postlink fixups and ARM ad-hoc entitlements/signature regeneration. Mac ad-hoc signatures do not establish Apple trust.

The package includes `stage-relink.py`, which verifies and stages the real inputs without executing tools, and precise host/toolchain/sysroot/source/library rebuild instructions. SDK/compiler/system inputs are explicitly user-provisioned; no historical compiler/linker micro-version or exact historical sysroot/SDK identity is invented. Public Linux reconstruction tool/sysroot pins and resulting file identities remain in the actual retained raw proof. Other target recipes derive from pinned source plus actual maps/caches; they are not claimed as executed observations.

A supplied private `rebuild-factory.mjs` recipe uses the pinned Bun API `compile.executablePath` to select a relinked runtime while executing the original clean frozen source/tooling recipe. Its derived diagnostic output is marked dirty/unpackaged, removes frozen-candidate fields and public-shaped release outputs, and records actual hashes if executed. This recipe was syntax checked; a modified Factory rebuild was not performed by this assembly. The original frozen release recipe remains unchanged.

## Real execution scope and validation

The Linux x64 kit retains **all 137 raw files / 92 actual commands** from representative run `38139122509`, including the observed Ninja response, full resolved config, tool/sysroot hashes and raw source/objects/patch/closure/native controls. The independent Linux review recorded in PR92 remains the execution evidence: complete original runtime `a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c` / 79,500,640 bytes, source-unmodified DateMath compilation/relink first, then only its member changed and really relinked. Explicit WTF `86400000 -> 116000000` behavior and unchanged V8 controls are retained. Hosted output binaries and generated maps were not uploaded; their logged hashes are observations, not retained binary files.

No new native modified runs were launched. The three other targets have authentic inputs and complete source-derived recipes, not executed modified-library observations. Representative execution plus four complete material kits is the user-authorized proportional assembly scope. Independent technical review must still assess kit functional completeness; structural intake and dry-run checks do not replace it.

- Actual schema 2 directory: **PASS**, 22,646 ms.
- Actual complete flat source archive: **PASS**, 31,825 ms.
- All four actual kit/source/cache staging checks: **PASS**; application/library/order hashes and full explicit archive input closure verified. Real Ninja1.13.0 parsed each graph and emitted its complete dry-run commands. No compiler/linker ran in these checks.
- Four complete official cache archives and all 20 supplemental dependency-source archives: **PASS** under the unchanged bounded portable archive reader.
- Existing semantic material/archive/path tests: **17 passed**, zero failures.
- `pnpm install --frozen-lockfile`, repository build and type checks: **PASS**. Owned Python/JavaScript recipes passed syntax checks. Normal pre-commit hooks run for the documentation/metadata commit.
- F1 is not applicable to this assembly/metadata change: no product workflow or F1 harness behavior changed. The frozen release payload retains its separate existing full-payload/native evidence obligations.

The [actual intake record](evidence/taskbot116-assembly/intake-result.json.raw), [staging checks](evidence/taskbot116-assembly/staging-checks.json.raw), [cache scans](evidence/taskbot116-assembly/cache-intake.json.raw) and [supplemental source scans](evidence/taskbot116-assembly/extra-source-intake.json.raw) preserve the bounded scope. Additional logs, preservation index, complete instructions and assembly/staging recipes live in the same owned outside-Git task directory.

Defaults remain **8GiB compressed / 4GiB member / 16GiB expanded per pass / 500,000 nested headers / 256 flat outer headers / 120s worker / 1MiB controls / 8MiB aggregate capture / 16MiB relink text**. No validator limits or legacy path were changed. The finished outer tar declares 4,150,240,768 expanded bytes including member padding. Every nested source/object/cache pass stayed within its fixed policy. Assembly finished with 21,388,088,623 logical owned bytes against the 40GiB new-material cap and 213,652,656,128 host-free bytes against the 100GiB floor. The pre-existing 16.944GiB material set was not modified.

## Licensing/source review inputs and remaining gates

The [component/notice inventory](evidence/taskbot116-assembly/component-notice-inventory.json.raw) retains selected pinned native source records, 110 original license-text snapshots, complete linked-library/polyfill/attribution tables, 283 immutable Cargo.lock package/source/checksum entries and 348 actual notice blocks per target. All 27 pinned patch snapshots are retained with hashes and source URLs; target application is defined by the pinned dependency generator, not asserted for every platform. Exact Factory supplemental license provenance is verified from the frozen commit. Bun/WebKit/TinyCC source and full candidate notice bytes accompany the material.

Cargo.lock registry records are inventory/review inputs, not a claim that every dev/target crate source was downloaded. The reviewer must assess the actual whole payload, in-tree components, Rust/npm/polyfills, system-library/SDK scope and any additional corresponding-source obligations; the desktop owner retains Electron/Chromium/package obligations. No legal opinion, completeness determination, fabricated passing receipt or acceptance is asserted. No `licensingAndSource` receipt exists for this new material.

Next: independent technical functional-completeness review and independent candidate-bound licensing/source review using the actual archive. Acceptance may be issued only after those reviews clear real material. Historical exact compiler/linker/sysroot/SDK identity remains unobserved; actual Linux reconstruction equivalence establishes function and bytes, not old historical identity. Other target link recipes and modified Factory rebuild are unexecuted. Later Mac DeveloperID signing invocation/trust is unobserved. These limitations stay explicit rather than becoming synthetic receipts.

Protected signing/authentic publisher pins, separate public-release/rollout approval, remaining operator evidence and GitGuardian reviews remain separate gates. The user-selected product minimums remain macOS15 and Ubuntu24.04/glibc2.39 on ARM64+x64; upstream reconstruction flags do not add older-platform product support. This pickup does not close Taskbot116 or change ticket status, activate public assets, or touch production homes/services/providers/native stores.

## Subsequent review1 correction kit

The original archive/80-record inventory above remains preserved. See the separately identified [review1 correction handoff](CORRECTIONS_REVIEW1_116.md) for the new 93-record kit, five per-finding responses, unchanged bounded intake, maintained future notice fixes and the frozen `.21` payload notice defect requiring candidate reissue. No acceptance receipt is issued.
