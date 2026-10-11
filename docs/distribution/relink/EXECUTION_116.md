# Taskbot116 Linux relink execution and follow-up

Both actual Linux x64 runs prove unchanged Bun configure/link/strip byte
equivalence. The second completed unchanged native smoke and a genuine modified
WTF source/member/link trial, but its changed native effect failed. Neither run
proves a successful modified-library effect. The correction below remains
pending fresh hosted execution and independent round3 review.

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
by cached-input runtime recheck. One added focused regression rejects accepting
the unchanged sentinel, corrupt second-date/arithmetic control or malformed output.

The first reconstructed Focal/GCC13 package and tool input pins remain unchanged.
Original historical sysroot file identities/compiler micro-version are still
unobserved. The narrow observed conclusion is byte equivalence of this unchanged
link's complete runtime output, not historical build-environment identity.

This lane leaves Factory source `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version
`1.0.0-nightly.20261010.21`, candidate digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`
unchanged. The modified runtime is an engineering probe, not a production candidate.
Independent round3 review and coordinator integration remain required. Full
dependency/source-license acceptance and the other three native relink targets
remain open. Selected macOS15/Ubuntu24.04-glibc2.39 ARM64/x64 minimums, reboot,
native credentials/providers, Apple signing, catalogs and parent release gates
remain coordinator-owned. F1 is not applicable to this tooling-only change.
