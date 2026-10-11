# Taskbot116 Linux relink execution and follow-up

The first actual Linux x64 run proves unchanged Bun configure/link/strip byte
equivalence. It does **not** prove completed native smoke or a modified-library
relink. The follow-up implements those checks and a genuine WTF source compilation
trial; its hosted outcome must be read separately from the preserved first FAIL.

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
date parsing is observed through JSC in the genuinely linked runtime. Missing
headers, compilation failure, archive drift, link errors or wrong native behavior
produce a concrete FAIL and retained evidence. See [recipe](README.md).

The first reconstructed Focal/GCC13 package and tool input pins remain unchanged.
Original historical sysroot file identities/compiler micro-version are still
unobserved. The narrow observed conclusion is byte equivalence of this unchanged
link's complete runtime output, not historical build-environment identity.

This lane leaves Factory source `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version
`1.0.0-nightly.20261010.21`, candidate digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`
unchanged. The modified runtime is an engineering probe, not a production candidate.
Independent round2 review and coordinator integration remain required. Full
dependency/source-license acceptance and the other three native relink targets
remain open. Selected macOS15/Ubuntu24.04-glibc2.39 ARM64/x64 minimums, reboot,
native credentials/providers, Apple signing, catalogs and parent release gates
remain coordinator-owned. F1 is not applicable to this tooling-only change.
