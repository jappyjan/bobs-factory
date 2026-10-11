Taskbot 116 source research continuation — 2026-10-11

The exact WebKit source and the four candidate base-runtime relationships have been recovered by actual acquisition and byte verification. Genuine native objects, WebKit prebuilt caches, four linker maps/features records, and the actual order files are retained. No native rebuild, real linker invocation, release signing, publication, license determination, or acceptance receipt was performed. Repository/root checkout and PR91 were not edited. Historical evidence remains unchanged in prior-research/. This report is research for coordinator/independent review.

All paths below are relative to the durable, outside-Git task directory:
/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs

+++Complete exact WebKit source

Official origin: https://github.com/oven-sh/WebKit.git, fetched explicit commit 2e2aa2290fac856d6f451ceacb58f7f5b44dd057, not HEAD. Tree 01e7ea36e5a23bf0206724ed83c594a2eaec95ed.

Fresh nonpartial bare fetch succeeded in 110.129 seconds. WEBKIT_FETCH_RESULT.json and webkit-full-fetch.log retain the command/result. Enforced limits were 32GiB total task retrieval, 24GiB per pack, 30 minutes, and at least100GiB host free. Previous partial clone was preserved unchanged. Full repo: webkit-complete.git. Complete detached owned checkout: WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057-checkout; git status --porcelain --untracked-files=no returned no changes. Offline git fsck --full --strict --no-reflogs exited0. GIT_NO_LAZY_FETCH=1 and protocol.allow=never were used for object inventory, source verification and archive generation; no remote lazy fetch was enabled.

Actual inventory:466297 Git file/symlink entries,405295 distinct blobs,22746 directories,464114 mode100644,2148 mode100755,35 mode120000. All referenced blobs were present locally. Expanded blob bytes including symlink-target text:5,474,280,234. Source inventory JSONL SHA256 f8dd766eeb1d59fd90e8c6e120829473d7a2b58b4cd92c60bf2ad578b280849b; NUL exact tree inventory SHA256368c50fa17e4972719f24f9dce3b9151548aac7f14848b522bfc2dba8d913c43.

Complete archive WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057.tar.gz:
- SHA256108dd98cc15bf43debc753cfb597b5635bd936855da2bb48bf0bcacc46881f7d
- Compressed1,993,738,581bytes; regular expanded5,474,279,499bytes
- 489846 actual headers including802 PAX headers;489044 ordinary entries, including22747 directories and35 symlinks
- Largest blob86,731,388bytes
- All Tests and other referenced source paths retained. Every blob SHA1 verified during writing and independently verified by streamed archive read afterward, including every path/mode/symlink target.

The exact97acf7ba6e00c81a480cd2f8d01c519ea2cf5f05 bounded-archive.mjs was copied to pinned-intake-check/ and used unchanged. Its default500000-header/16GiB expanded/8GiB compressed/4GiB member/120sec policy accepted the actual archive in14883ms. No intake limit was relaxed. See WEBKIT_SOURCE_VERIFICATION.json, WEBKIT_ARCHIVE_RESULT.json, WEBKIT_ARCHIVE_INDEPENDENT_VERIFICATION.json and WEBKIT_CURRENT_INTAKE_RESULT.json. A generic Python PAX-only writer would emit916240 headers; the actual writer used standard USTAR where representable plus PAX only where needed, preserving the full tree within the unchanged limits.

For eventual source-material intake, use canonical filename webkit-source.tar.gz with unchanged bytes/root and source URL https://github.com/oven-sh/WebKit/tree/2e2aa2290fac856d6f451ceacb58f7f5b44dd057. The current schema accepts that tree URL; the research provenance commit URL alone is not one of its allowed source-record strings. No source-material acceptance record is synthesized here.
+++

+++Durable genuine downloads

PRESERVATION_MANIFEST.json records atomic/hash-verified preservation of95 prior research files totaling720,387,127bytes, including all8 C++/Rust application archives totaling583,272,677bytes. Original RESEARCH_DOWNLOAD_MANIFEST.json and all-four-upstream-artifacts.json are unchanged. Public Buildkite artifacts expire2027-03-04; expiry, original catalog/hash and public artifact provenance are retained.

Additional acquired material:
- LINK_INPUT_DOWNLOAD_MANIFEST.json: all18 actual WebKit LTO libraries from Buildkite110323 plus three emitted order files. All actualSHA256s match upstream catalog.
- RUNTIME_CACHE_DOWNLOAD_MANIFEST.json: actual Buildkite/published runtime ZIPs for remaining3targets and all4 official exact-pin WebKit LTO cache archives, each provider/catalog hash verified. WEBKIT_CACHE_INVENTORIES.json proves all18 matching libraries in these official caches are byte-identical to Buildkite inputs. Linux caches also contain libicutu.a, which was not among the six linked/catalogued libs; it is not a mismatch in the actual linked inputs.
- Actual Linux WebKit compile_commands.json (707commands each): x64 SHA2568ccd24af9098a44cd8b2c6fa0d9930842aae60afddbb956a9de2501bb72414b2, ARM64e3983f5f4ad310c58380d19acc37c53eb541eadf0260898bd00edca11a846fcc. Headers and corresponding libraries remain within the preserved official cache archives.
- PROFILE_CONFIG_DOWNLOAD_MANIFEST.json: genuine profile ZIPs for all4targets, plus extracted actual features.json, four linker maps and three actual linker.order inputs. Maps contain45,599,947bytes Linuxx64,52,858,723 LinuxARM,19,608,640 Macx64 and19,364,239 MacARM. Features all name exact Bun744846f844374847c902b5e7fd59b4342a51ef99/version1.4.2/noncanary. Their complete original ZIP inventories/hashes are retained.
- actual-inherited-order/ORDER_PROVENANCE.json: actual MacARM and Linuxx64 order inputs from Buildkite110317, independently downloaded/hash verified; embedded profile order copies match those exact hashes. MacARM edfd0474affcc9dee361452be47cf4394f0f6a4c2ee2d21e4cadbd87db15b6c2,1,089,931bytes; Linuxx64 32c24058f67945853c9e97c35a8dd6ece17b7c493249dab1a442a20250c20dd3,1,156,033bytes. #110323's later trace-order outputs are different and must not be substituted. LinuxARM genuinely traced then relinked in110323; its1,163,683byte orderSHA41ca700c51b22234de2dacba20bdb97c893e23c4c46dfff9fd18995ab390a544 matches the profile copy. Macx64 has no emitted/used order input in its profile/log.
- official-pinned-sources/SOURCE_DOWNLOAD_MANIFEST.json: official exact-pin Bun codeload64,602,344bytes SHA25625e09a8804535b8fbea1dad9f95af8402fc9133d28127d5594ff00df1549590e (21700archive entries/197365006expanded); TinyCC1,036,641bytes SHA25650750680312923a59fdd36ae41f7091d8e35e51909d0e0b25b0b33ea9534bc08 (560entries/4524388expanded), pin05f0fafaa3be31e31d7b4b5c17dc60f62c991171. These are official acquired archives, not an independent full-Git equivalence claim or license approval. Bun source includes its exact TinyCC patch.
+++

+++Observed upstream runtime correspondence

Actual Linuxx64 and ARM Buildkite ZIPs and their executables match actual published release ZIPs/executables byte for byte. This replaces the prior catalog-only comparison.

Both Mac executable mismatches are completely accounted for by observed signature changes, rather than a strip/code difference. MacARM all20 section layouts and17 file-backed section contents agree. Every byte up to signature offset61,744,416 matches after zeroing ONLY __LINKEDIT.vmsize/filesize and LC_CODE_SIGNATURE.datasize (offsets2024:8,2040:8,2572:4). Normalized SHA256955ecc09e9536cebcf16d2547b0b5b70fb0cbff8634dc7cbf3a0f8173a7d27f7. The full343599byte length difference equals signature483647→140048. Buildkite ad-hoc signature uses4096byte pages/15075slots; release DeveloperID JarredSumner7FRXF46ZSN uses16384byte pages/3769slots with hardened runtime and timestamp. Macx64 all sections agree; its entire68,776,480byte Buildkite file matches the release pre-signature prefix after masking ONLY ncmds/sizeofcmds, LINKEDIT sizes and the new16byte CODE_SIGNATURE command. Normalized SHA256bafad05db0e716434c42625a55673cfa9a7c6cdbc8b2fbec700b727464502ae3.

MACHO_COMPARISON.json and codesign-display outputs are retained under mac-comparison/; other targets under runtime-correspondence/ALL_TARGET_RUNTIME_COMPARISON.json. No inputs altered. Pinned release.yml's sign job runs GPG upload-assets, not observed Mac codesigning. Pinned shims/macho-postlink.c describes the Buildkite ad-hoc cross-build treatment. The precise later DeveloperID signing invocation is still unobserved; the byte-accounted signature change does not require guessing its command.
+++

+++Actual frozen candidate .21 base-runtime byte proof

All4 GitHub binary artifacts were retrieved afresh and retained in candidate-21/. Provider container SHA256s, run38086228778/headb82c37c4fb9a3e18d1cb222c6d56d3fef852096f were checked. The complete actual tar member inventories/hashes matched the immutable97 source-b82 artifact index. Actual build.json metadata matches candidate digest ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec, version1.0.0-nightly.20261010.21 and each target. No version-only inference was used.

Actual published base runtimeSHA256:
- darwin-arm64:35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5
- darwin-x64:2fa513af22ac59e03aae640cad302e73cb1ddb0f6398501e2ddccf7dcd613596
- linux-x64:a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c
- linux-arm64:616f267a34278ff5ac282df37ffdfba1d7141f4f6926bca99af2cd6ef3ad32b1

Pinned src/exe_format/{elf,macho}.rs and StandaloneModuleGraph.rs were downloaded/hashed. Owned Python static comparison independently applies their exact injection layout to the actual published base plus the actual candidate's bounded payload. It compares every resulting byte; it does not invoke Bun, link, compile or sign.

Linuxx64 entire reconstructed executableSHA144e32d1894e912072948379210eb1f6e30c688be8aeeee7f8b2d21e27b50caa equals actual candidate. LinuxARM entire reconstructedSHAf211479c82733e2c466e5f80ef7f8ffef77b305aafb069e4907c85a2d935a6f8 equals actual candidate. All base data, zero-fill, payload injection, original .bun pointer, ELF headers/relocated tail and writable PT_LOAD changes are accounted for. Source's ARM page size is65536; x644096. Both base interpreters already have source's canonical paths; no interpreter rewrite was needed.

Macx64 entire reconstructed executableSHA087ee6c64f3c53a499d0ad88b102a8cae97e2f2a0bea2f10a8ddf29f644d4843 equals actual candidate, including unchanged original signature bytes. This establishes runtime correspondence, not continued Apple signature validity after compilation. MacARM all100,853,024 pre-signature bytes match the exact source-predicted BUN/LINKEDIT/header transformation (SHAa41b8e58c4cd15e44690c9c245a9600e4d8d92f9bb8d6191634c13341de2dcdc). Its actual788050byte regenerated ad-hoc signature has all metadata bytes matching the pinned signer fields/formula and all24623SHA256 code-page hashes verified; identifiera.out/flags0x20002/no specials/no trailing bytes. No unexplained region was masked.

All4 embedded standalone graph length prefixes, exact trailer '\n---- Bun! ----\n',32byte Offsets structures, byte_count and pointer bounds also verify against the pinned format. See BASE_RUNTIME_BYTE_BINDING.json, FORMAT_INSPECTION.json, STANDALONE_GRAPH_FOOTERS.json, ACTUAL_PAYLOAD_VERIFICATION.json, DOWNLOAD_PROVENANCE.json. Reproducible inspection/comparison scripts are at task root. The compact signature-metadata follow-up was a read-only comparison; its result is recorded in BASE_RUNTIME_BYTE_BINDING.json.

The build.json schema still omits base hashes, but an actual external byte-bound research record now identifies them. This recovers the previous runtime-binding uncertainty for independent review; it does not rewrite frozen metadata or automatically satisfy licensingAndSource/native-relink acceptance.
+++

+++Actual objects, configs and remaining relink work

GENUINE_AR_MEMBER_INVENTORIES.json streams all8gzip/ar archives, inventories every member/contentSHA256 and detects genuine LLVM bitcode magic. C++ member counts ARM Mac1149/Macx641173/LinuxARM1148/Linuxx641172; Rust170/170/171/171. TinyCC libtcc.c.o,tccpp.c.o,tccgen.c.o,tccdbg.c.o,tccelf.c.o,tccasm.c.o,tccrun.c.o (plus Mactccmacho.c.o) exist in actual application archives. Rust bun_tcc_sys members also exist. TinyCC is not a missing separate catalogued library in this archiveDeps=false build.

actual-buildkite-logs/PROVENANCE.json preserves actual public job logs from /organizations/bun/pipelines/bun/builds/110323/jobs/JOB/log.json, all HTTP200. Logs show the exact node scripts/build.ts --profile=ci-build commands, builds, uploads, strip, and order handling. They do not contain an actual expanded link command, response file or complete serialized Bun resolved config. Do not label source-derived flags as an observed .rsp.

LINK_MAP_INPUT_CLOSURE.json captures genuine linked archive/CRT/sysroot paths from all4maps. Linuxx64 uses /opt/linux-sysroot-glibc including x86_64 GCC13 crtbeginS/crtendS/libstdc++.a/libgcc_eh.a and libc_nonshared.a; ARM uses the corresponding arm64sysroot plus libgcc.a. Both link6WebKit libraries plus application C++ and Rust archives. Other bundled dependencies are members of those application archives. Macmaps identify MacOSX26.5.sdk libSystem/libc++/libicucore paths, not a redistributed SDK here. Sourceconfig explicitly uses Ubuntu20.04+GCC13 sysroots for CI glibc compatibility. Original sysroot file identities and actual linker/compiler micro versions are still missing. LLVM desired constant21.1.8 accepts21.1.x; logs showllvm-21 but do not independently establish its exact micro. Rust nightly-2026-07-20 is observed in logs.

Concrete next owned Linux relink task, without full Bun rebuild:
1. On disposable owned Linux CI, preserve all acquired input hashes and immutable Bun pin744846f844374847c902b5e7fd59b4342a51ef99. Stage Linuxx64 C++ archive as libbun-profile.a and Rust as rust-target/x86_64-unknown-linux-gnu/release/libbun_runtime.a. Stage six verified WebKit libraries at cache/webkit-2e2aa2290fac856d-lto/lib/. Extract generated WebKit headers/configs from verified official cache. Stage the ACTUAL #110317 order as linker.order (hash32c240...), not #110323's later trace result.
2. Recover/reconstruct the documented Ubuntu20.04+GCC13 x64sysroot and compatible LLVM21.1/Rust-nightly environment; record exact executable/version/sysroot file digests. Prefer reproduce original aarch64 Debian13 cross-host if byte-identical link goal requires it. Native x64 CI can first test functional relinking, but different host/toolchain is not automatically unchanged-runtime equivalence.
3. Run the pinned configure generator in link-only mode with CI/Release/LTO semantics retained, Buildkite operations disabled and --configure-only. Suggested starting command for the NEXT authorized CI task: node --experimental-strip-types scripts/build.ts --profile=ci-link-only --os=linux --arch=x64 --abi=gnu --canary=off --buildkite=off --configure-only --build-dir=OWNED_ABSOLUTE_DIR. Inspect the resolved config/build.ninja before execution, retain input/config JSON and generated definitions/export lists/linker scripts. This command is a proposed starting recipe, not an executed verified command. Keep archiveDeps=false, pinned target/CPU/LTO settings; avoid debug/release-local default substitutions.
4. Inspect ninja -t commands for bun-profile/bun, then invoke only link/strip outputs with ninja -v -d keeprsp; disable artifact-download/upload/codegen rebuild edges and verify input closure first. Retain actual expanded command, .rsp, flags, maps, strip command, outputs/digests. Original pinned rule uses clang++ @$out.rsp $ldflags; .rsp contains newline-separated C++ then Rust then six WebKit archive inputs. The configured system libraries/sysroot/CRT and source's Linux symbol wrappers are consequential.
5. Compare unchanged link/strip runtime to actual published base SHAa83d263..., analyzing any residual differences against original maps and toolchain identities. Then rebuild a small controlled library change under exact source/ABI/LTO settings, replace only appropriate library input, really relink and run native smoke. Retain modification, commands, logs and resulting hashes. Repeat actual validation for other targets as required. No relink success can be declared from this research.
6. Have independent reviewers assess candidate correspondence, completeness/notices/dependency source and real relink evidence. Other bundled dependency source/notices still need a complete review; acquired Bun/WebKit/TinyCC sources alone are not a legal completeness determination. If recipe/runtime is changed to compile.executablePath or an owned runtime, freeze a NEW candidate and perform all4native/full-payload validation. Current .21 payload remains unchanged.

Remaining UNPROVEN: actual native link response/resolved Bun config/toolchain/sysroot file identities; executed unchanged and modified-library relinks/smoke; independent license/source acceptance and remaining dependency source closure. Signing/rollout/production/provider/minimum-platform gates remain owned by the coordinator. This lane neither closes Taskbot116 nor changes ticket statuses.
+++
