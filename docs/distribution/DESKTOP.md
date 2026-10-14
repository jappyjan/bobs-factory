# Desktop candidate preparation

The native shell reuses the Factory web UI and APIs. Its launcher opens the local
Factory without enrollment or login, or connects to an explicit remote HTTPS origin
with that host’s browser session established with an API key. Local launch goes directly to repository/provider
onboarding without installing agents or moving their native credentials. The launcher
never reads or injects dashboard API keys. Each dashboard origin has a separate
persistent Electron session. Factory web contents have sandboxing, context isolation,
no Node integration. Its minimal preload can only open the local app settings
window. The packaged launcher owns connection and shell-update actions;
sender/frame/URL are checked by the main process for every bridge request.
Cross-origin navigation is blocked, and external HTTP(S) links open in the browser.

Closing the dashboard hides its window on macOS and Linux. Quit desktop UI leaves
the detached worker running. Reopen reattaches to its ownership record and dashboard
port. **Factory → Stop local Factory** separately confirms graceful termination
and targets only the selected desktop-owned worker, verifying its nonce, executable,
home and process start identity. Independently managed services/remote hosts require
their own controls. No client action supplies update consent.

The first-release minimums selected by the user are macOS 15 and Ubuntu 24.04 /
glibc 2.39, on ARM64 and x64. Observed native CI coverage is macOS 15.7.9 and
Ubuntu 24.04.5 / glibc 2.39 on both architectures. These observations do not prove
macOS 15.0, every Ubuntu 24.04 kernel/image variant, or other Linux distributions.
Functional first-launch/authentication, update and OS lifecycle validation remain
required for the actual delivered target; paid signing is not a release gate.
Windows/musl are excluded. Artifact names:

- `bobs-factory-desktop-VERSION-mac-ARCH.dmg`, with Bob's Factory.app and Applications link.
- `bobs-factory-desktop-VERSION-linux-ARCH.AppImage`.
- `bobs-factory-desktop-VERSION-linux-ARCH.deb`.

AppImage/user installation ownership differs from DEB/AUR/Homebrew/system packages.
System/external managers own their upgrades. DEB/AUR/system paths, Homebrew
Caskroom/Cellar links and non-writable/non-user-owned apps show an owner handoff.
A normal DMG app in Applications is eligible when the app is user-owned,
both app and parent are writable, and its complete bytes
match a validated release inventory.
An arbitrary writable executable or symlink is insufficient update authority.

## Complete app updates

**Factory → Desktop app updates** shows the local shell's exact version/commit,
channel, effective policy, pending candidate, result and recovery state. The shared
dashboard Updates page opens these local settings separately from the selected
backend's settings. Shell settings live in `<factoryHome>/desktop/updates/state.json`
and use the same `UpdateManager` policy, revisions, consent and candidate rules as
runtime updates. Stable defaults to Notify/manual Install; nightly defaults to
Automatic when idle. Both channel overrides persist, along with pause and exact pin.
Verify installed app enrolls only a byte-matching published release inventory. Without that
receipt the app checks/notifies but cannot activate. Missing, corrupt or
unpublished inventories remain visible integrity failures. No publisher key pins
or Apple Developer account are required.

Install authorizes the displayed exact candidate at the displayed settings
revision. Cancel pauses queued activation. The supervisor rechecks policy and idle
state at its atomic stopping boundary. Once stopping/recovery begins, conflicting
settings changes are rejected until completion; Quit/window close is never consent.
An intentional older stable shell requires explicit Install even in automatic mode.
Polling/backoff/coalescing use the existing shared manager. Changing the shell
policy cannot change or activate any local/remote backend's policy.

The complete desktop inventory binds the installer, `updateArchive`, update metadata
and validation to channel/version/commit/target, candidate digest and tooling SHA.
Linux updates replace the exact hash-bound AppImage bytes. macOS additionally delivers
a complete `.bobsapp.gz` recovery archive: a framed gzip inventory retaining file
bytes, modes and internal framework links, rejecting traversal/link ancestry and
special files. The DMG remains the drag/drop installer. `prepare-desktop-update.mjs`
verifies candidate identity, retained notices and the exact extracted app
fingerprint. macOS metadata describes `unsigned` or free local `ad-hoc` signing;
activation requires neither Developer ID nor notarization/Gatekeeper assessment.
Apple Silicon packaging uses an after-pack local `codesign --sign -` operation for
Mach-O execution, without publisher certificates, keychain discovery or Apple
credentials. Existing Bun/Electron runtime signatures retain their technical role.

For a downloaded DMG, drag Bob's Factory.app into Applications and try opening it.
If macOS blocks an unidentified developer, open **System Settings → Privacy &
Security → Open Anyway**, then choose **Open** in the next prompt, following
[Apple's per-app instructions](https://support.apple.com/en-us/102445). Keep the
quarantine attribute and Gatekeeper enabled; the app/installer/updater never
clears quarantine or disables system protection. Staging carries the installed app's
`com.apple.quarantine` onto the extracted app, and activation preserves its current
value on the replacement before renaming. The switch journal retains this OS
metadata for recovery/rollback independently of the published byte fingerprint;
inspection/write failures block replacement. Repeat the per-app approval if
macOS requests it for a later downloaded version. A future first-launch validation
must use the actually quarantined package and record the user's allow action;
source-entry execution does not establish this result.

Before replacement an external helper retained outside the app acquires the
existing per-home lifecycle guard/update fence and the authenticated local drain.
It admits no active work or descendant leases, captures the existing worker PID/
nonce and waits for the precise Electron UI process to exit. It does not stop,
start, replace or upgrade that worker. It replaces the whole app, retains previous
bytes, launches the new UI, and verifies a transaction-bound health receipt and
unchanged worker ownership. Failed candidates are suppressed and restore the
verified previous UI with its own health check. Config, checkpoints, worktrees,
native credentials and conversation stores are never copied or rewound. Interrupted
switches retain the journal, old app and fence for explicit recovery. Ambiguous
process ownership blocks recovery rather than signaling an unrelated process.

An older runtime lacking `desktop-app-maintenance-v1` must be updated separately
through its owner before shell activation with a live local worker. The backend
serves its own versioned dashboard; same-protocol shell/runtime versions may differ.
Unsupported protocol is refused with explicit owner guidance, while existing web
build checks pause stale writes. No connection or shell update updates remote hosts.

## Candidate preparation and validation

`desktop-build.yml` prepares unsigned four-target installers from frozen candidate
bytes, with a hash-verified matching runtime, exact source/version/target and
`desktop-build.json` inventory. Its pull-request preparation route executes only
for the same-repository desktop delivery branch; it freezes the exact PR head
for both source and tooling, never the synthetic merge. One candidate is shared
across all native jobs. This lets review obtain unsigned native evidence without
merging the product to register a dispatch workflow. Read-only permissions and
credential-free checkouts accompany builds with publication disabled; no signing
or publication secrets are supplied. It never uses publisher certificates, notarizes or publishes. Native Apple Silicon
packaging applies only free local ad-hoc signing for executable validity. Local build:

```sh
node scripts/build-desktop.mjs --candidate /private/candidate.json \
  --runtime /private/bobs-factory-VERSION-TARGET --output /private/desktop
```

The build copies the exact pinned Electron distribution's `LICENSE` and
`LICENSES.chromium.html` to `Resources/electron-licenses` on macOS and
`resources/electron-licenses` on Linux. Desktop update metadata binds their
version, sizes and SHA-256 digests to the candidate. Preparation inspects the
actual read-only mounted DMG, extracted AppImage and DEB, and the extracted
complete macOS recovery archive; missing or changed notice bytes fail the build.
`desktop-build.json.licenseValidation` retains candidate-bound installer hashes
and actual notice comparisons. These checks do not constitute source/relink or
release licensing acceptance. The frozen ed7/58 packages predate this correction;
their runtime notice files do not prove Electron/Chromium notice inclusion.
Runtime source/rebuild material and reviewed licensing receipts remain separate
release gates.
The [complete-shell validation report](../../apps/f1/test-drives/2026-10-10-desktop-shell-update.md)
preserves exact candidate hashes, actual native notice receipts and their limits.

Native WebAuthn availability is a capability of the installed OS/authenticator.
The existing optional `BOBS_FACTORY_WEBAUTHN_ACCESS_GROUP` configuration is
host-owned; this delivery creates no shared access group, entitlement or keychain
material, and does not read credential stores. Keep protected enrollment and
session boundaries, and validate the supported authentication paths at their
actual scope; physical passkeys are not a blanket gate for every release test.
Electron documents potential Keychain prompts across unsigned updates and limits
for its own login-item/Squirrel.Mac APIs in [its signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing).
Bob uses its custom complete-app updater and user-owned launchAgent/service
manager, rather than Squirrel.Mac or `setLoginItemSettings`. Validate those paths
functionally; these upstream limitations are not paid-account prerequisites.

Before release, retain actual isolated native receipts for DMG drag/open, Linux
packages, automatic direct localhost access and remote authentication enrollment/login/logout, secure-origin/session
isolation, window close/reopen while jobs run, explicit Stop, crash restart, workflow
and native-session continuation, client-version mismatch, and successful/failed
updates. Publication remains a separately authorized #117 stage;
this preparation workflow is not proof those checks passed.
