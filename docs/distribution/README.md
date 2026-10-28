# Binary distribution

Install with the [two-command quick start](../../README.md#install-and-start).
The public installer detects your OS/CPU and downloads a verified version without
GitHub login, GitHub CLI, Node or Bun. GitHub HTTPS and SHA-256/size inventories check release integrity. First launch opens protected browser setup
for a project, prepared agent and GitHub connection. Agents may have their own
runtime and login requirements.

The shared [`release.json` contract](PUBLIC_RELEASES.md) drives the installer,
homepage and Nix package. The installer selects verified stable releases, or the
latest validated beta before the first stable release. Nightly is explicit
(`--channel nightly`) and never becomes the default. When no reviewed release is
available, the homepage and installer report unavailable downloads. CI artifacts
remain maintainer validation material.

The maintained [downloads page](https://jappyjan.github.io/bobs-factory/downloads/)
is the index for all supported entry points. It lists the verified CLI bootstrap
and marks desktop, package-manager and npm paths unavailable until their actual
assets and package identities exist. No Homebrew cask, Linux desktop package or
public npm launcher is currently published. A public npm launcher is a separate,
minimal product from private workspace packages and must execute the same unsigned
release contract; npm/Node is a launcher prerequisite only, not a Factory runtime
prerequisite.

The artifact contract is `bobs-factory-VERSION-TARGET.tar.gz` with a matching
`.manifest.json`: schema version, product, exact version, commit, target, byte size
and SHA-256. `build.json` inside adds tooling, executable hash and resource digest.
Release candidates also bind a digest, committed package version and frozen tooling
revision. CI accepts a release-version override without editing the checkout;
stable rebuilds receive their own byte-bound validation.
The same verified commit, target and resource digest are embedded in the runtime
identity returned by `/version` and `/api/version`, alongside the product
version and dirty-build flag. Development runtimes report unknown source identity;
the current Git checkout is not evidence of the installed executable's commit.
Run attempt provenance retains the identity that actually executed each attempt,
including when a frozen run resumes after an upgrade.
Supported target names: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.
Bun 1.4.2 bundles the runtime; immutable dashboard/prompts/skills are embedded and
verified before extraction into a content-addressed private resource directory.
The installed Factory executable and its internal helpers require no separate
Node, npm, pnpm or Bun installation. Git and prepared coding agents remain external
prerequisites; their executables, SDKs, native sidecars and credentials are not all
bundled. [Video evidence validation](../FACTORY.md#authentic-demonstration-videos) also requires
local `ffprobe` and `ffmpeg`.

Source development, builds, tests and the optional trial npm launcher support
**Node 24 only**. `.node-version`, CI and frozen release tooling pin 24.18.0; the
workspace requires the 24.x major, pnpm 10.33.1 and Bun 1.4.2. Node 22 support is
removed. These source tools are not binary-runtime prerequisites.

```sh
pnpm install --frozen-lockfile
pnpm --filter 'bobs-factory...' build
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/factory-build
factory_version=$(node -p 'require("./apps/cli/package.json").version')
./scripts/smoke-binary.sh "/tmp/factory-build/bobs-factory-$factory_version-darwin-arm64/bobs-factory"
```

Compile success is not runtime evidence. Native-target smoke must check isolated
startup, dashboard shell/assets/API, scoped MCP access, shutdown and restart.
Prepared-agent execution needs additional validation. The archive contains no
Cursor SDK, native Cursor programs or rebundled SDK chunks. The factory-owned
permission hook invokes the factory executable. Cursor runs in a separate process
using the operator's prepared SDK and Node installation; other agents use their
prepared launchers. The installer verifies the whole archive and rejects traversal,
duplicate entries and special files.

### Prepared Cursor installation

For binary installations, prepare `@cursor/sdk@1.0.19` and
`@connectrpc/connect-node@1.7.0` together in a directory owned by the service account.
Use Node 24 for the prepared SDK host. This is an agent prerequisite; the
factory and its internal MCP helper still run without Node/npm/Bun. For example,
using your existing npm setup:

```sh
npm install --prefix ~/.local/share/bobs-factory-cursor @cursor/sdk@1.0.19 @connectrpc/connect-node@1.7.0
```

Set these in the service environment or `<factoryHome>/.env`:

```sh
BOBS_FACTORY_CURSOR_SDK_PATH=~/.local/share/bobs-factory-cursor/node_modules/@cursor/sdk
BOBS_FACTORY_CURSOR_NODE=/absolute/path/to/node
```

`BOBS_FACTORY_CURSOR_NODE` defaults to `node` on PATH. Keep Cursor authentication
in its supported account configuration (`CURSOR_API_KEY`); do not send credentials
in tickets. The adapter checks the SDK version before starting. Native session IDs,
MCP options, events, usage and cancellation cross a private process IPC channel.
Missing preparation fails with setup guidance; no automatic installation occurs.
Checkout development continues to use its own installed SDK. This change does
not relocate or convert native conversations. Authenticated Cursor validation was
waived by the human for this implementation; it is not claimed as passing evidence.

First-release minimums are macOS 15 and Ubuntu 24.04 / glibc 2.39, for ARM64
and x64 (user decision, October 11). Observed CI is macOS 15.7.9 and Ubuntu
24.04.5 / glibc 2.39 on both architectures; it does not prove macOS 15.0, all
Ubuntu kernel/image variants or other Linux distributions. Historical native
acceptance is documented in [the final report](FINAL_NATIVE_116.md). Its prior paid-signing
gates are superseded by the current [unsigned release contract](PUBLIC_RELEASES.md); musl and
Windows are not claimed.
The build uses [Bun executables](https://bun.sh/docs/bundler/executables), with
resources and helpers embedded through the explicit boundary implemented here.

## Attribution and rebuilding

Archives retain Apache-2.0 source attribution and aggregate full dependency notices
in `THIRD_PARTY_NOTICES.txt`. Supplemental upstream license snapshots have source
URLs and SHA-256 provenance in `licenses/sources.json`. The build rejects bundled
Cursor modules and does not copy agent installations into the archive.

Bun links LGPL JavaScriptCore/WebKit and other libraries. Its full license guidance
and linked-library notices accompany candidates. To rebuild with modified libraries,
use the [Bun 1.4.2 source](https://github.com/oven-sh/bun/tree/bun-v1.4.2) and its
[relink instructions](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md), then
build this repository's exact candidate and lockfile with that runtime. Distribution
must include the exact source/rebuild material needed for the selected runtime;
the later publication role must verify this alongside license completeness. Local
development candidates are not a completed release compliance package.

Cursor's proprietary SDK and native sidecars remain in the operator's separately
prepared installation. Bob’s Factory does not redistribute or modify those files.
The archive's runtime dependency inventory excludes them.

Complete source archives that exceed GitHub's individual asset limit use hash-bound
ordered chunks. They reconstruct the exact full archive before unchanged source
intake; local source evidence and historical single-file releases remain intact.
See [source transport and offline recovery](PUBLIC_RELEASES.md#complete-source-transport).

## Installation and manual replacement

The public installer is the primary installation path. For maintainer validation
or manual replacement, download an exact version's archive, matching manifest and
`install-binary.sh` from the same trusted release. When validating CI artifacts,
retrieve the verifier from the immutable candidate's source commit. The SHA-256
manifest verifies downloaded bytes; trust the release source as well. Run:

```sh
sh install-binary.sh ARCHIVE.tar.gz ARCHIVE.manifest.json ~/.local
export PATH="$HOME/.local/bin:$PATH"
bobs-factory --version
```

The installer keeps immutable versions under `PREFIX/lib/bobs-factory/` and
atomically switches `PREFIX/bin/bobs-factory`. It retains the prior version/link
for manual recovery. State is never stored under the prefix.

Manual replacement over a retained home needs no state editing:

1. Stop intake, drain and stop the worker and its descendants (desktop: **Stop
   local Factory**; service: stop its unit with `launchctl`/`systemctl`). Do not
   run old and new workers together.
2. Install the new build with the commands above, or drop the new desktop app
   over the old one. Desktop installs keep the runtime link at
   `~/.bobs-factory/runtime/desktop-installed/bin/bobs-factory`; if the new app
   does not adopt its bundled runtime, point the link at the new executable:
   `ln -sfn NEW_EXECUTABLE ~/.bobs-factory/runtime/desktop-installed/bin/bobs-factory`.
3. Start it. The new build records itself as the installed build (an update that
   was still in progress is reported with a single command to resolve it,
   `bobs-factory update recover --adopt-installed`), migrates data only if its
   data format is newer (backing up just the files that migration touches), and
   removes leftover copies from the older updater. Settings, history and runs are
   retained.
4. Verify one worker, preserved home/config and continuation after restart.

To go back, stop the workers, point the executable link at the retained previous
version and start it. Data written in a newer format is refused by the older
build (exit code 78); restore the pre-migration files with
`bobs-factory update restore-backup --yes` first while the backup still exists
(until the first start after the migration committed, or 14 days). The
[per-instance updater](UPDATES.md) implements hash-bound discovery, remembered
stable/nightly policy and owned staged replacement that swaps only the runtime
link, with journaled crash recovery. [User services](SERVICES.md) and
[desktop app updates](DESKTOP.md) have separate lifecycle owners; rollout still
requires genuine release evidence and actual functional validation.

Bootstrap installs also keep an ownership record under
`PREFIX/lib/bobs-factory/records/`. It records the exact release channel, version,
target, source commit and hash-bound release identity, separately from
`~/.bobs-factory`. Reinstalling does not reset per-instance settings. Package
managers and Nix retain ownership of their own paths; do not replace those
executables with the bootstrap installer. See
[package entry points and safe removal](PACKAGE_ENTRY_POINTS.md) for updater handoff,
receipt-checked uninstall, generated Homebrew/AUR recipes and npm operator gates.
The trial retains separate state in `~/.bobs-factory-trial`.

The binary CI workflow remains build/verification only, with immutable candidate
input. The separate [public release workflow](PUBLIC_RELEASES.md) defaults to a
dry run and publishes only explicitly approved, fully validated immutable artifacts. Upstream
npm publishing scripts/workflow are retained as historical files in `scripts/archive`;
they are not supported fork commands. Future publishing must retain the exact
reviewed candidate, all-target evidence and manifest checks.

## Operator MCP smoke

The installed executable supports `operator grant|list|revoke` and the protocol-only
`operator-mcp --home PATH --credential-file PATH` bridge. Follow
[operator setup](../factory-operator-mcp.md) using a fresh private home. Verify scoped
MCP discovery and an inspection against the running isolated worker; revoke the
grant and verify the same client can no longer discover/call tools. The bridge
must not start another worker or bypass dashboard API keys.
## Nix from the same release manifest

Pin a reviewed release's `release.json` as a file in your Nix configuration.
[`nix/package.nix`](../../nix/package.nix) selects the platform and fixed archive
checksum from that manifest:

```nix
bobs-factory = import /path/to/bobs-factory/nix/package.nix {
  inherit pkgs;
  releaseManifest = ./bobs-factory-release.json;
};
```

Keep the exact reviewed manifest bytes. Historical beta manifests additionally
require the reviewed complete inventory attestation described in the
[public release contract](PUBLIC_RELEASES.md). Nix checks the attestation's exact
manifest identity/hash/size and required four-target evidence before unpacking;
archive downloads are fixed by SHA-256. These are integrity checks over HTTPS,
without an independent publisher signature claim.
Keep `nix/validate-beta-attestation.jq` with `nix/package.nix` in reviewed tooling.
The package fetches public versioned assets without GitHub credentials. An
unavailable manifest fails evaluation clearly. Update the pinned manifest when
upgrading; avoid fetching a mutable latest pointer during evaluation. Keep the
service's home, environment and conversations separate from the immutable Nix
package, and drain/stop the old worker before an intentional upgrade.
