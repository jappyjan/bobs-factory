# Pinned Linux x64 relink diagnostic

This is disposable engineering work for [Taskbot #116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116).
It does not change the Factory runtime or produce a release/source-license
acceptance receipt. The initial branch starts at PR #91 commit
`c3cc8644ac34c53b185e6b8598966fcf366497ca`; integration belongs to the coordinator.

`linux-x64-inputs.json` records the genuine Bun `744846f844374847c902b5e7fd59b4342a51ef99`
application archives, exact WebKit LTO cache and six linked-library identities,
the **used #110317** order file, and actual published Bun runtime. Every acquired
archive is checked before extraction. The acquired research report, index and
candidate base-binding record are identified by SHA-256; they remain outside Git.
Large inputs, WebKit's complete source archive and frozen Factory artifacts are
not copied into this repository or into the diagnostic evidence upload. The
modified trial acquires only the exact `Source/WTF/wtf/DateMath.cpp` and
`Source/WTF/config.h` from official commit URLs, with SHA-256/size and Git-blob
identities independently verified against the retained complete source tree.

The test provisions Node 26.3.0, LLVM 21.1.8 and Rust nightly 2026-07-20 beneath
its fresh task directory. Official source/provider checksum records pin them.
The LLVM extraction selects genuine binaries, Clang runtime files and shared
libraries, leaving unrelated static development libraries in the pinned archive.
It reconstructs the documented Ubuntu 20.04/GCC 13 link sysroot from five pinned
Focal packages and the official GCC 13 overlay. This follows the relevant portion
of pinned `scripts/bootstrap.sh`, without Docker, image extraction, package
installation on the host, or global service management. The original Ubuntu
image layer, package versions and compiler micro-version are unobserved. The
original host was ARM64 Debian 13; this runner is native x64 Ubuntu 24.04.
Reconstruction is not itself evidence of byte equivalence.

The unmodified `scripts/build.ts` runs `--profile=ci-link-only --os=linux
--arch=x64 --abi=gnu --canary=off --buildkite=off --configure-only`, with owned
absolute build/cache/sysroot paths. A separate reader calls the same configure
function to retain its complete returned config, outputs and computed flags.
Release, LTO, CI, noncanary, archiveDeps=false and exact source pins are asserted.
Configuration never invokes the main build or Buildkite artifact orchestration.

Before linking, the harness retains `build.ninja`, unresolved and resolved config,
symbol exports/version script, exact order file, tool versions and file hashes,
sysroot/cache file inventories and both `ninja -t commands` results. Only the
verbatim generated link and strip rules/edges are selected into
`relink-only.ninja`; their expanded commands must equal the original graph's
commands. The runner performs a dry run and, in `unchanged` mode, executes
`ninja -v -d keeprsp -j1 bun`. Ninja creates the retained genuine `.rsp` during
that invocation. No synthetic response file is described as executed evidence.

The `configure` mode stops after configuration and dry-run checks. The
`unchanged` mode additionally compares the stripped output against published
base SHA-256 `a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c`
and runs version/revision/hello/standalone-injection smoke with the **relinked**
runtime. Any byte differences remain unresolved until ELF reports, maps,
toolchain and sysroot identities explain them. A mismatch does not become an
equivalence PASS. The `modified` mode requires actual byte-identical unchanged
output and completed unchanged native smoke before its library trial. Pinned Bun's
CLI prints `1.4.2+744846f84` (nine SHA characters); smoke also requires the exact
full `Bun.version + '+' + Bun.revision` value. The full source pin and all
input/output hashes remain explicit provenance bindings.

The trial reads the real `DateMath.cpp` compile entry from the official cache's
hash-verified `compile_commands.json`. It retains every define, target, CPU, ABI,
ThinLTO and optimization flag. Original compiler/include/output/source/debug
prefix paths are remapped explicitly in `webkit-compile-remaps.json`: exported
cache headers replace unshipped build-host hmaps/build directories, the pinned
LLVM compiler replaces `/usr/bin/clang++-21`, and the reconstructed Focal/GCC13
closure replaces host system headers. No PCH is needed by this translation unit.
Both unmodified and changed source are compiled under those same flags. Actual
compiler dependency files enumerate and hash every header; a dependency outside
the owned task directory fails the trial. This is an engineering compile recipe,
not a claim of byte-identical recompilation of the original object.

The controlled change makes WTF's `parseES5Date` return `116000000` only for
`1970-01-02T00:00:00.000Z`. Normal JSC returns `86400000`. `llvm-ar rD --format=gnu`
replaces only `DateMath.cpp.o` in the extracted real `libWTF.a`, retaining its
original copy. Inventories require all 175 member names/order and every other
member's size/hash to agree; the replacement must match newly compiled LLVM
bitcode. The other five WebKit libraries and both application archives must
remain hash-identical. The same generated link/strip edges run again. The
relinked executable must show the changed date, normal second-date parsing and
JS startup, plus exact version and full revision. The retained unchanged
executable is rechecked afterward. Overall `modified` result PASS is set only
after all required stages succeed.

The manual workflow and initial owned-branch push use read-only contents/actions
permissions and no secret inputs. A job has a 45-minute timeout; the harness has
a 42-minute deadline, a 25 GiB owned-file budget and a 10 GiB free-space reserve.
Only its fresh temp tree is written. Command timeouts kill the owned process
group; hosted-runner disposal handles the remaining temporary files. Evidence
uploads run even after failure and contain phase/error results, commands/logs,
config and hashes, actual response files, source patch, original/recompiled/changed
objects, member inventories, compile dependency closure and output hashes.
Maps are hashed in `captured-evidence.json` and omitted from compact uploads;
the first run's complete raw map and tool/sysroot inventories are preserved in
the durable outside-Git directory. Actual runtimes and libraries remain in the
owned task until runner disposal; large binaries are not uploaded. No signing, release publication, channel
activation or production installation is performed.

Run on a disposable Linux x64 host with Python 3.12+, Ninja, CMake, binutils and
`dpkg-deb` already prepared:

```sh
python3 docs/distribution/relink/test_linux_x64.py
python3 docs/distribution/relink/linux-x64.py \
  --root /absolute/new-owned-task-directory \
  --evidence /absolute/owned-evidence-directory --mode unchanged
```

Use `--mode modified` for the complete engineering trial; owned branch pushes
run that mode. The shell uses `pipefail`, so assertions or missing compile inputs
fail the workflow step while `always()` retains the nonpassing receipt.
Workflow/check status alone is never substituted for `result.json`.

The [first execution report](EXECUTION_116.md) distinguishes its exact unchanged
output proof from the preserved smoke FAIL and the new trial's pending result.
Its compact raw evidence index binds the complete original artifact.

F1 is not applicable: this change tests external pinned native-link tooling and
does not change Factory product workflows or the F1 harness. Syntax, graph safety,
archive-boundary checks and the actual disposable CI execution are the relevant
validation. Independent source/license review, all-target release validation and
integration/eligibility decisions remain with the coordinator.
