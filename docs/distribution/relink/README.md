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
not copied into this repository or into the diagnostic evidence upload.

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
equivalence PASS. Modified-JSC/library compilation and relinking remain a later
step contingent on this real unchanged-link outcome; TinyCC-only substitution
would not satisfy that step.

The manual workflow and initial owned-branch push use read-only contents/actions
permissions and no secret inputs. A job has a 45-minute timeout; the harness has
a 42-minute deadline, a 25 GiB owned-file budget and a 10 GiB free-space reserve.
Only its fresh temp tree is written. Command timeouts kill the owned process
group; hosted-runner disposal handles the remaining temporary files. Evidence
uploads run even after failure and contain phase/error results, commands/logs,
config and hashes, actual response/map when present, and a compressed relinked
runtime only after smoke succeeds. No signing, release publication, channel
activation or production installation is performed.

Run on a disposable Linux x64 host with Python 3.12+, Ninja, CMake, binutils and
`dpkg-deb` already prepared:

```sh
python3 docs/distribution/relink/test_linux_x64.py
python3 docs/distribution/relink/linux-x64.py \
  --root /absolute/new-owned-task-directory \
  --evidence /absolute/owned-evidence-directory --mode unchanged
```

F1 is not applicable: this change tests external pinned native-link tooling and
does not change Factory product workflows or the F1 harness. Syntax, graph safety,
archive-boundary checks and the actual disposable CI execution are the relevant
validation. Independent source/license review, all-target release validation and
integration/eligibility decisions remain with the coordinator.
