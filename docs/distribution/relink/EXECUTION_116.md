# Taskbot116 Linux relink execution and follow-up

The first two actual Linux x64 modified trials correctly failed their native
effect requirement. A third run passed the complete modified diagnostic on the
exact PR92 source head. The two failures remain preserved as historical evidence;
the third result is a disposable engineering PASS for Linux x64 only. It does not
establish production default behavior, source/license acceptance, or release
readiness.

The separately identified run `38138403930` used exact source head
`53f6e03d0f28f53d7b305384d869d9d892328c52`. This documentation update did not
refresh its provider status or consume a new receipt; its outcome is not merged
with the failures below or attributed to the passing 46373dd run.

[Run 38134978416](https://github.com/jappyjan/bobs-factory/actions/runs/38134978416),
job `114456890512`, executed exact PR92 head
`41c5b5bc3147b45baf3300595b5912319109ba5b`. The workflow and GitGuardian check
concluded success; the engineering `result.json` concluded FAIL after 613 seconds.
The old `python | tee` pipeline did not propagate Python's failing exit status.
The follow-up explicitly enables `pipefail` and retains errors on failure.

Artifact `11700568368`, 4,625,402 bytes, SHA-256
`d4376514c06fed216b8cad0dd7a600a0443fb392eb3cc8c55d1df92504a7a98a`
was downloaded and checked against provider metadata. Complete ZIP/raw contents,
including the real `.rsp`, resolved config, commands, maps and tool/sysroot files,
remain at `/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/relink-execution/run-38134978416/`.
The [compact index](evidence/run-38134978416/index.json) binds every original file;
selected files are copied byte for byte with `.raw` suffixes. Large map and
tool/cache/sysroot inventories remain in the complete outside-Git preservation
and original provider artifact. The original `result.json.raw` is never rewritten.

Observed first result:

- Configure: true. Actual generated restricted link and strip commands executed;
  Ninja created the retained response file. No application rebuild was executed.
- Stripped output: 79,500,640 bytes, SHA-256
  `a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c`.
  This matches **every byte** of the actual published Bun 1.4.2 Linux x64 runtime.
- Profile output: 158,819,840 bytes, SHA-256
  `45b419f6b15af79a913836a2ccca6a72528eaf464be71b7bd31b56339b602ec7`.
- Revision stdout: `1.4.2+744846f84\n`; the assertion incorrectly expected
  `1.4.2+744846f844`. `nativeSmoke=false`, `modifiedLibraryRelink=false` and
  `phase=FAIL` remain the original result.

The revision correction follows exact pinned Bun `src/bun_core/env.rs`
(`GIT_SHA_SHORT` slices nine characters), `Global.rs` (version plus short SHA) and
`src/cli/mod.rs` (revision writer). Native smoke now checks exact version, exact
CLI revision, full `Bun.revision`, hello, JSC date behavior and unchanged standalone
injection. Focused tests accept the observed output and reject wrong version,
wrong short revision, ten-character formatting and a wrong full SHA sharing the
same short prefix. Source SHA remains bound through all verified inputs and the
recorded output hash, not just CLI text.

The modified trial acquires the exact DateMath source/config files, reads the
official cached compile record, and records every header/tool/path remap. It
compiles unmodified and changed source with the original ThinLTO/ABI/CPU/defines,
verifies LLVM bitcode, replaces only `DateMath.cpp.o` in real GNU `libWTF.a` using
pinned `llvm-ar`, and checks all other members/archives unchanged. Its sentinel
date parsing must be observed through JSC in the genuinely linked runtime. Missing
headers, compilation failure, archive drift, link errors or wrong native behavior
produce a concrete FAIL and retained evidence. See [recipe](README.md).

## Second actual run: source compiled and linked, native effect FAIL

[Run 38136567511](https://github.com/jappyjan/bobs-factory/actions/runs/38136567511),
job `114461539235`, executed exact head
`56d290c2053b78d694104132fe8e7689c698775d`. Both workflow and engineering result
concluded failure. The corrected `pipefail` propagated the native assertion.
Unchanged link/strip again produced the complete expected runtime SHA/size above;
exact version, short/full revision, hello, date behavior and standalone injection
passed. Original and modified genuine DateMath ThinLTO compilations, exact
single-member replacement and generated modified link/strip completed.

The modified native date output remained `[86400000,172800000,42]\n` instead of
`[116000000,172800000,42]\n`. `modifiedLibraryRelink=true` is only link completion;
`modifiedNativeSmoke=false`, `nativeSmoke=false`, `phase=FAIL`, error and failed
phase `modified-library-native-smoke` remain unchanged in the original receipt.
Elapsed time was 1185.999 seconds. Changed runtime bytes alone did not prove the
required semantic effect.

Provider artifact `11701541666`, 1,051,988 bytes, SHA-256
`678c4ff768e7ac27e30b057bca91709d9eb5eb2d11596dcd7f28a726c40aa960`
is preserved at
`/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/relink-execution/run-38136567511/`.
The ZIP digest matches provider metadata; all 111 raw files match the ZIP and all
uploaded entries in the original captured inventory. The [compact index](evidence/run-38136567511/index.json)
binds every uploaded file and the omitted maps' captured hashes. Raw result,
config, generated commands/response files, compile recipe/dependency hashes,
source patch, member inventories and native outputs are copied byte for byte.
Objects, maps and large inventories stay outside Git. The original upload omitted
three maps; their bytes are unavailable after runner disposal, so only their
captured hashes are retained. Exact56 workflow/harness/input bytes were recovered
from Git and verified against the runner's harness hashes in `exact56-source/`.
The first run's ZIP/all 80 raw files and tracked compact evidence remain immutable.

The actual original/unmodified-recompiled/modified object SHAs were respectively
`105da2e5c0fbf851ab404699117ec7f1c5742e2c503ee631b279728217f5e5ec`,
`57dcc30e31bad09562346f5a325dcbe678bcbca3d2407b33a78c7333dce5c7f1`,
`6b2b6b38a4903d9828cadeacbc9d6d968a74e5a5138daca8bf32c81cd28ae39a`.
Only `DateMath.cpp.o` changed among 175 real archive members. Modified `libWTF.a`
SHA was `03f77608797a977c6ed802aa04190a38535dd528358d90afce67811ca211c2b3`;
modified stripped output was 79,504,832 bytes, SHA
`3b7cbf717041dd558da05234f32705e6a6c4d3975c8e9b4c007982c310063046`.
These are failed-trial identities, not accepted artifacts.

## Third actual run: Linux x64 modified native effect PASS

[Run 38139122509](https://github.com/jappyjan/bobs-factory/actions/runs/38139122509),
attempt 1, job `114469122766`, was a push for exact commit
`46373dd964bed8752cd283bc93adcecb57c27380`. The GitHub Actions workflow and
`linux-x64` job both concluded success. Its official artifact is
`source-relink-linux-x64-46373dd964bed8752cd283bc93adcecb57c27380-1`, ID
`11702782070`, 1,114,753 bytes, provider digest
`sha256:46458411db546143d69b62759b6321188aec234003e1c4ba05ac2d5bf12caae7`.
The downloaded ZIP matches that digest and size. It contains 137 members
(4,625,277 uncompressed bytes); [the complete member index](evidence/run-38139122509/index.json)
binds each name, size and SHA-256. All member bytes, including the provider ZIP,
are also preserved outside Git at
`/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/relink-execution/run-38139122509/`.
Compact raw copies of every uploaded member are retained alongside the index.
The artifact's captured-evidence list has 140 entries; all 136 entries marked
for compact upload match the artifact exactly. Its four large linker maps remain
represented by their captured size/hash records rather than being uploaded.

The run's original `result.json` reports `status=passed`, `phase=PASS`,
`exactBaseBytes=true`, and successful unchanged, recompiled-baseline and
modified native/link checks. The unchanged Bun 1.4.2 linux-x64 runtime was
79,500,640 bytes with SHA-256
`a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c`, equal to
the pinned published runtime. After both native relinks, the cached-input
runtime was rechecked against the same hash and native smoke outputs.

The native outputs establish the changed-source effect through the explicit
WTF backend while retaining the V8 parser as a control:

- Unmodified recompiled source: both WTF and V8 return
  `[86400000,172800000,42]`.
- Modified source: WTF returns `[116000000,172800000,42]`; V8 remains
  `[86400000,172800000,42]`.
- The unchanged cached runtime recheck returns the original values on both
  backends.

Each genuine DateMath source compilation used the pinned ThinLTO compile entry.
The original `DateMath.cpp.o` SHA-256 was
`105da2e5c0fbf851ab404699117ec7f1c5742e2c503ee631b279728217f5e5ec`; the
unmodified recompiled object was 105,352 bytes,
`3dbdb23c6fa5c94692d9c663318162b978b4c0471ac14358fd46f8515e0ba076`; and the
modified 40,819-byte source produced a 106,232-byte object,
`1f154fb43b1927dbf55a37da610d3752ada79bf16794ceb1b4c38537790036d2`. The
actual generated restricted Ninja link/strip edges and each run-created `.rsp`
are retained as `original-ninja-commands.log.raw`,
`restricted-ninja-commands.log.raw`, `relink-only.ninja.raw`, and the three
`*-bun-profile.rsp.raw` files in the evidence directory. Both archive stages
retain all 175 `libWTF.a` member names and their order; only `DateMath.cpp.o`
changes, and each replacement hash matches its corresponding compiled bitcode.
The five other WebKit libraries and two Bun application archives remain pinned.

Evidence identities bind the executed harness to
`linux-x64.py` SHA-256
`e6fdf647e32a9714f7d0297b763902ad140c7ddc4533b88798a0cb5d7bc91285`,
`webkit_trial.py` SHA-256
`d45e1bf7b6f39e373ef66eb641e50f30e52aa09f4538d4a1eb741082467286ad`,
`test_linux_x64.py` SHA-256
`a32f2f9e3f7be55cc453c659481716ea109e948129b61ce3f88309a9320d5879`,
`capture-config.mjs` SHA-256
`c309c2b8cb65ac35bd08d9d9235c3513910b9d748ffb7652e73df13621759221`, and
`linux-x64-inputs.json` SHA-256
`6ea269a1d0efbb873d4cc2de6d9312c8426f4b2a03125af9dc183096279a23f5`.
Tool versions, downloaded source/cache identities, compile dependency closures,
configuration, commands, sysroot inventory and source/object/member proofs are
preserved in the compact artifact. The original source and toolchain pins remain
as documented above; the original historical compiler micro-version and full
sysroot digests remain unobserved.

The run took 1533.877 seconds. It validates this isolated engineering diagnostic
on Linux x64. It does not change Bun's production default backend, rebuild V8,
prove the other three native targets, or complete schema-2 source/license,
signing, release, catalog or operator acceptance. No release candidate or
production installation was changed.

## Concrete diagnosis and correction

Pinned Bun `src/jsc/bindings/ZigGlobalObject.cpp:316` sets
`JSC::Options::useV8DateParser() = true`. Pinned WebKit
`Source/JavaScriptCore/runtime/JSDateMath.cpp:440–449` returns through
`v8::ParseDateTimeString` when that option is enabled, bypassing the changed
`WTF::parseES5Date` call at line 450. Bun disables generic `JSC_*` environment
options and applies `BUN_JSC_*` after its defaults, via `Options::setOption`.
This explains the failed default-backend smoke without guessing about LTO or
changing the meaningful expected effect.

Before another hosted trial, an isolated executable copy of the original pinned
darwin-x64 Bun was run with `BUN_JSC_useV8DateParser=true` and `false`, plus
`BUN_JSC_dumpOptions=2`. Actual dumps confirmed both selections, and both original
native outputs were `[86400000,172800000,42]\n`. Raw stdout/stderr and binary hash
remain in outside-Git `relink-execution/date-parser-diagnosis/`. This verifies
pinned option handling only; it is not modified Linux or four-platform acceptance.

The correction keeps the exact source patch, genuine compile recipe and native
sentinel assertion. Every runtime smoke executes the same JS with both explicit
native parser selections and requires an actual matching option dump. The V8
control stays at the original value. Only the WTF backend in the modified runtime
must change `86400000` to `116000000`; the second date and arithmetic stay intact.
Inherited engine option overrides are removed from the child's environment.
The unmodified recompiled TU is now also inserted as the sole changed archive
member, genuinely linked/stripped and required to preserve both native baselines
before the modified-member trial. Both stages retain complete member inventories,
actual response files, captured map hashes and separate runtime hashes/flags.
Overall PASS requires recompiled baseline and modified effect completion, followed
by cached-input runtime recheck. Nine focused tests include a regression that
rejects accepting the unchanged sentinel, corrupt second-date/arithmetic control
or malformed output.

The first reconstructed Focal/GCC13 package and tool input pins remain unchanged.
Original historical sysroot file identities/compiler micro-version are still
unobserved. The narrow observed conclusion is byte equivalence of this unchanged
link's complete runtime output, not historical build-environment identity.

This lane leaves Factory source `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version
`1.0.0-nightly.20261010.21`, candidate digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`
unchanged. The modified runtime is an engineering probe, not a production candidate.
Independent fresh evidence retention review and coordinator integration remain
required. Full dependency/source-license acceptance and the other three native relink targets
remain open. Selected macOS15/Ubuntu24.04-glibc2.39 ARM64/x64 minimums, reboot,
native credentials/providers, Apple signing, catalogs and parent release gates
remain coordinator-owned. F1 is not applicable to this tooling-only change.
