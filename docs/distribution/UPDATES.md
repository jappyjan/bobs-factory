# Per-instance updates

Each selected backend keeps settings and update receipts in
`<factoryHome>/updates/state.json`, separate from immutable runtimes and native
credential/conversation stores. Stable defaults to **Notify / manual Install**;
nightly defaults to **Automatic after draining active work**. Each channel
remembers its explicit override. Reinstalling, closing a window and switching channels do not grant
manual Install consent or reset saved choices. The persisted policy token
`idle-auto` remains supported; it now drains active work instead of waiting for
an empty queue.

Use Settings → Updates on the selected authenticated backend, or:

```sh
bobs-factory --home /path/to/instance update status
bobs-factory --home /path/to/instance update settings --channel nightly
bobs-factory --home /path/to/instance update settings --policy manual
bobs-factory --home /path/to/instance update settings --pause
bobs-factory --home /path/to/instance update settings --resume --pin 1.2.0
bobs-factory --home /path/to/instance update settings --unpin
bobs-factory --home /path/to/instance update settings --channel stable --policy default
bobs-factory --home /path/to/instance --port 3457 update check
bobs-factory --home /path/to/instance --port 3457 update stage
bobs-factory --home /path/to/instance update candidate
bobs-factory --home /path/to/instance --port 3457 update install --candidate EXACT_ID --revision N
```

Offline status/settings use the local operator's filesystem authority. Running
check/stage/Install use the existing memory-only terminal session through the
loopback dashboard. Remote browser operations retain API key/browser session, exact
origin, request-header and client-build checks. There is no webhook update API.
A client controls only its connected instance; desktop and remote hosts keep
independent identities and policy. UI drafts retain the existing client/PWA
protocol protections. A failed settings save retains the draft.

Pause cancels activation authorization, including queued automatic work. A pin
selects an exact version and prevents automatic activation; an intentional
manual Install still uses the same drain/compatibility checks. Clearing a pin or
resuming is explicit. Every settings revision invalidates previous manual
consent. New candidates replace older pending candidates without carrying their
consent forward. Intentional return from nightly to stable, or another downgrade,
requires Install even with a saved automatic stable override; compatibility
preflight must still pass.

The external owner supervisor calls `UpdateManager.tick()` on a bounded timer.
Release discovery polls every 15 minutes with exponential offline backoff capped
at six hours. Publication cadence is separate. Offline errors remain visible;
previously verified pending state survives. Discovery uses the canonical hash-bound
published-release verifier, complete inventory, exact target/channel and frozen
source checks. Stage reauthenticates the immutable release, downloads only bound
assets, runs its verified archive installer into an isolated staging prefix and
probes the candidate version with a temporary home. No production link changes
occur during stage. An integrity/staging or trial failure suppresses that exact
candidate until deliberate `update install --retry` after inspection.

## What an update does

An update swaps the program and leaves your data where it is. Data is only
changed by an explicit, versioned migration, and only the files that migration
declares are backed up. A normal update therefore needs megabytes of free disk
space, not a copy of your home, and takes seconds once the worker is idle.

`UpdateLifecycle` is implemented by the external owner supervisor, not the
worker being replaced. Checkout, Nix and externally managed/system-package
installations must upgrade through their owner. The shared updater alone does
not implement those activation mechanisms. A manual Install queues consent;
it does not forcibly stop a busy worker.

1. **Stage and verify** while work continues. The exact candidate is downloaded,
   hash-checked, installed into an isolated staging prefix and probed.
2. **Prepare** (before anything stops). The supervisor re-verifies the staged
   build identity, asks the candidate which data format it writes and migrates
   from (`service format --json`, read-only), rejects a candidate that cannot
   read your data (cancelled, not marked bad), checks free space, and
   pre-creates both runtime links: `bobs-factory.next-<id>` to the candidate and
   `bobs-factory.prev-<id>` to the current build. Switching and rolling back
   then are two `rename` calls that allocate nothing, so a full disk cannot
   strand an update.
3. **Drain.** Maintenance suppresses service auto-restart, freezes new
   dashboard/webhook intake and closes capacity admission. Active slots and
   in-flight delivery finish naturally; later workflow steps pause at their saved
   checkpoints and queued slots are parked in their original order. Waiting human
   review/answer gates are allowed. Active work is never signalled to meet an
   update schedule. Pausing updates or changing policy before the switch cancels
   activation, releases maintenance and resumes the retained work. A provider
   request already in flight settles before the drain becomes idle.
4. **Stop and switch.** Policy, pause, pin and exact consent are rechecked at the
   atomic stopping boundary. After the old worker and its descendants are
   confirmed gone, the `next` link is renamed over the live link.
5. **Start.** One replacement starts with the same home and user. The
   transaction ID is passed to it, so a data migration it runs is bound to this
   update (see below).
6. **Health.** The new worker must report the candidate's exact version, commit
   and target, own the instance lock, load without errors, and still have every
   run, saved workflow and native session the previous worker had loaded
   (`GET /api/updates/data`). The check compares what was loaded by identity,
   never by bytes, so a Linear token refresh rewriting `config.json`, or a run
   recipe serialized differently by the new build, cannot fail an update.
   Records added meanwhile are fine; none may vanish. The window is 120 seconds,
   extended up to ten more minutes only while a migration keeps making progress.
7. **Commit.** The journal records `committed`, then `state.json` records the
   installed build, then maintenance is released and retained work resumes.

If anything fails from the switch on, the supervisor stops the replacement,
renames the `prev` link back, restores the migration backup if one is bound to
this transaction, starts the previous build and checks its health. No file in
your home is copied back. A candidate that fails is not offered again until a
deliberate `update install --retry`. Running out of disk space, a cancelled
update and interrupted attempts are environmental: they do not blame the
candidate, except that a candidate which interrupts or fails the same way twice
is marked bad so it cannot loop.

## Data format and migrations

`<home>/state-format.json` records the layout of your data on disk
(`{schema, format, minReader, applied}`); a missing file is format 1, today's
layout. Every build declares the format it writes and the oldest it can migrate
from, and checks this before opening any state:

- Data newer than the build understands: the build refuses to start (exit code
  78, so service managers do not hot-loop) and leaves everything untouched.
  Install a build that supports it, or restore the migration backup.
- Data older than the build can migrate: refused with the version to upgrade
  through first.
- Data older than the build writes: the pending migrations run, in order, before
  the worker serves anything. This is the only migration path, for updater-driven
  and manual installs alike. The format file is written last, so a crash at any
  line re-runs to the same result.

Each migration declares the files it touches (named files, or the direct
`*.json` children of a directory); anything else is refused. Before it runs,
only those files are cloned (copy-on-write where the filesystem supports it)
into `updates/migration-backup/current/`, with a manifest. At most one backup
exists, capped at 1 GiB of touched files, and it needs free space for itself plus
a margin; the check happens before the worker is stopped. Restoring is a rename
of the saved files and removal of files that did not exist, so it works on a
nearly full disk. A backup bound to a successful update is deleted at the first
start after it committed, or after 14 days. Non-additive migrations (readable
data would be unreadable to builds from before this mechanism) are not allowed
yet.

```sh
# Worker stopped. Put back the files the last migration changed:
bobs-factory --home /path/to/instance update restore-backup --yes
# Keep the current data and delete the backup:
bobs-factory --home /path/to/instance update discard-backup --yes
```

## Crashes and plain restarts

Each update keeps a small journal in `updates/journal/<id>.json`, written and
synced before each side effect. It is a sidecar of `state.json`, which older
supervisors rewrite without it. After a supervisor, worker or machine crash, a
plain restart reconciles from the journal and the real state on disk (which link
is live, who owns the instance lock, the backup manifest). The rule is one
sentence: **anything not committed rolls back**, and the update is retried as a
new transaction afterwards. A crash after `committed` but before `state.json`
was written finishes the commit instead. Stale `next`/`prev` links of abandoned
updates are removed, and a `state.lock` left by a killed process is taken over
once its owner is gone. `recover("operation owner stopped")` remains the
confirmed CLI path for an operation lock whose owner cannot be inspected; never
remove a live operation lock.

## Manual installs

Installing a newer app or archive by hand over a retained home is supported:

- With no update in progress, or only a finished and acknowledged one, the
  installed build is simply recorded as the truth (an `observed-install` record
  in `updates/history/`). Settings, pins, pauses, bad-candidate marks and history
  are untouched, and the instance starts normally.
- A newer data format is migrated by the new build's own startup, with the same
  touched-file backup.
- With an update still in progress when a different build starts, the instance
  still starts and Settings → Updates and `update status` show what happened and
  the next step. Resolve it with
  `bobs-factory update recover --adopt-installed` (add `--yes` to confirm). If
  the installed build is the candidate, the update completes and its migration
  backup is committed. Otherwise the update is closed as superseded; a migration
  backup bound to it stays restorable, and the command prints how to restore or
  discard it.

Stop the worker before replacing the program (desktop: **Stop local Factory**;
service: stop its unit with `launchctl` or `systemctl`). See
[manual replacement](README.md#installation-and-manual-replacement).

## Updating from an older supervisor (v2)

Updaters before this change copied the whole home twice per attempt and compared
a fingerprint of all state before and after. A supervisor keeps running its own
code after it replaces the worker, so the first update into this build may still
be driven by such a supervisor, and supervisor/worker version differences are
normal in both directions. This build therefore keeps the v2 protocol working:

- the candidate answers the old `service validate-state` probe with the same
  `factory-preservation-v2` contract and workflow IDs;
- `GET /api/updates/drain` returns the digest the old supervisor saved when it
  captured the idle state, as long as the new worker loaded every run it
  recorded without errors, so rewritten `config.json`/recipe bytes during the
  old flow's long copy window no longer roll the update back;
- `state.json` stays schema version 1 and the new fields live in sidecars.

That old flow still needs about twice your home size in free disk space (about
33 GB on one real machine, so more than 66 GB free) while it copies, and a
window of tens of minutes. If you cannot spare that, update by hand instead: stop the worker,
install the new build over the retained home, start it. Nothing needs editing.
Once started, the new build removes the copies the old updater left behind
(`updates/preparation`, `updates/snapshots`, `updates/recovery-retained`, their
retention records and proofs), after the old update's maintenance has been
acknowledged. It never removes a directory that holds a linked, staged or
running runtime, or anything referenced by an unresolved update, and an
outdated desktop supervisor is replaced by the new build's. The v2 compatibility
is removed in a later release once no older supervisor remains.

## Protected hooks and evidence

Protected supervisor hooks are `POST /api/updates/maintenance` with
`{transactionId, action: "begin" | "end"}`, `GET /api/updates/drain` and
`GET /api/updates/data`. The transaction must match persisted updater state.
Drain returns idle/busy and capacity observations; these are not unauthenticated
health shortcuts. A reboot with retained maintenance does not automatically
resume workflow/native execution before supervisor reconciliation.

`recover("operation owner stopped")` requires explicit confirmation and rejects
an operation lock whose recorded PID is still alive or cannot be inspected.

The updater regression suite and mocked F1 drive cover policies, settings races,
active-slot draining and queued-step recovery, one controlled worker, preserved
native checkpoint IDs and human gates, crashes at every journal step, disk
exhaustion, migration and rollback, manual reinstalls, and a frozen copy of the
old supervisor driving the first update into this build. They use controlled
candidates/supervisors and do **not** establish native OS service behavior or
release publication. Final integrated macOS/Linux target receipts, complete
byte-bound integrity/functional evidence and exact-candidate publication remain
necessary before rollout. No publisher signing keys are required.

## Storage retention

Settings → Storage and `bobs-factory storage` preview and clean verified owned
artifacts: delivered worktrees (thirty days) and reconciled migration copies.
Staged runtimes are not retention records: after an update the supervisor
removes every staged directory that nothing refers to, keeping the live runtime
and the previous one (the targets of the live, `next` and `prev` links and the
executables named by the current transaction). See the
[storage runbook](../factory/storage-retention.md) for policy and interruption
recovery.
