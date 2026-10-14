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
loopback dashboard. Remote browser operations retain passkey/session, exact
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

## Recover an older updater blocked by evidence links

An older supervisor can report `Snapshot refuses external/special owned state:
factory/evidence/.../node_modules` even after downloading a release that fixes
that error. The running supervisor performs preflight and snapshot copying, so
the fix in the pending binary cannot take effect until a newer supervisor runs.
Replacing the desktop app alone retains the existing backend runtime.

The state-copy fix shipped in `1.0.2-beta` and
`1.0.0-nightly.20261013.38484193828` ([#128](https://github.com/jappyjan/bobs-factory/pull/128)).
It omits evidence symlinks from isolated preflight, retains their exact link
strings in rollback snapshots, and never reads their targets. Linked configuration
or saved state outside evidence still fails closed.

For a desktop-owned backend with a cancelled, acknowledged transaction and
`switchStarted: false`, an operator can bootstrap the fixed supervisor:

1. Retain a copy of `<factoryHome>/updates/state.json` for diagnosis. Inspect its
   pending candidate, installed identity and transaction. If replacement started,
   or maintenance release is not acknowledged, use transaction recovery first.
2. Use a fresh trusted public installer to install that exact fixed release into
   a **separate absolute prefix**, with `--no-modify-path`. Match the selected
   channel (`--channel nightly` for a nightly); this authenticates the download
   without changing the active backend link or its settings. Keep the prefix
   until recovery completes.
3. Read `<factoryHome>/runtime/update-supervisor.lock` with `readlink`: its target
   is a JSON ownership record. Match the home, owner, PID, process start time and
   command to the running supervisor, then send **only that supervisor** SIGTERM.
   Wait for it to exit and release its lock. Leave the desktop and worker running.
4. With the verified recovery executable, print the exact candidate and revision,
   then deliberately retry it through the authenticated loopback dashboard:

   ```sh
   "$recovery" --home "$factory_home" --port "$port" update candidate
   "$recovery" --home "$factory_home" --port "$port" update install \
     --retry --candidate "$candidate" --revision "$revision"
   "$recovery" --home "$factory_home" --port "$port" --no-open \
     service updates-run --once
   ```

   Set these variables from the selected instance and the `update candidate`
   output. `recovery` is the new prefix's `bin/bobs-factory`. The last command is
   the owner supervisor entry point; it still enforces installation ownership,
   normal capacity drain, compatibility preflight, snapshot and health checks.
5. Check `update status`: require the intended installed commit, a `succeeded`
   transaction and acknowledged maintenance release. Verify the dashboard and one
   worker. Restart the desktop's supervisor using the now-active owned executable
   (`service updates-run`, without `--once`), retaining its normal desktop owner
   environment and log redirection. A normal desktop relaunch also starts it.

If the one-pass supervisor returns while work is still draining, keep using the
fixed supervisor until activation completes. Inspect a failed trial before another
explicit retry. Preserve evidence links and update receipts throughout recovery;
do not delete evidence, remove ownership locks, edit the update journal, or switch
the live executable link by hand to get past this failure. User-service and
externally managed installations must use their own supervisor/owner handoff.

## Restart and recovery boundary

`UpdateLifecycle` is implemented by the external owner supervisor, not the
worker being replaced. Checkout, Nix and externally managed/system-package
installations must upgrade through their owner. The shared updater alone does
not implement those activation mechanisms. A manual Install queues consent;
it does not forcibly stop a busy worker.

1. Download, verify and prepare the candidate while work continues normally.
   Once staging finishes, persist the exact candidate, previous identity and
   transaction, then acquire owner maintenance. Maintenance suppresses service
   auto-restart, freezes new dashboard/webhook intake and immediately closes
   capacity admission under its lock. Ticket retry timers pause.
2. Let existing capacity slots and in-flight delivery finish naturally. New
   workflow steps pause at their saved checkpoints; queued slots are parked
   with their original ordering for recovery. Keep the same drain transaction
   open until executing/stopping leases, descendants and accepted operations
   settle, even with queued runs remaining. Waiting human review/answer gates
   are allowed. Never signal active work to meet an update schedule. Pausing
   updates or changing policy before the switch cancels activation, releases
   maintenance and resumes the retained work. Accepted PR setup input without
   a native session is retained without event credentials and replayed after
   release; existing sessions retain their saved input and conversation IDs.
3. Preflight state compatibility in isolation and snapshot bounded compatible
   Factory-owned state. Native credential/conversation/signing stores and
   Factory authentication remain outside rollback. Observe config/profile,
   accepted definition/output/checkpoint/gate/answer/ticket and native-session
   preservation digests; concurrent filesystem edits must fail health/rollback
   comparison rather than being silently overwritten.
4. Recheck policy, pause, pin and exact consent at the atomic stopping boundary.
   Confirm old worker/descendant exit before switching the owned executable.
   Start one replacement with the same home/user, validate exact identity and
   preservation receipt, then release maintenance and resume retained work.
5. On failed trial, stop the replacement before restoring the previous executable
   and only compatible bounded Factory state. On rollback or maintenance failure,
   keep a durable recovery-required transaction and suppression for inspection.

Protected supervisor hooks are `POST /api/updates/maintenance` with
`{transactionId, action: "begin" | "end"}` and `GET /api/updates/drain`.
The transaction must match persisted updater state. Drain returns idle/busy,
capacity observations and `preservedStateSha256`; these are not unauthenticated
health shortcuts. A reboot with retained maintenance does not automatically
resume workflow/native execution before supervisor reconciliation.

`recover("operation owner stopped")` requires explicit confirmation and rejects
an operation lock whose recorded PID is still alive or cannot be inspected. It
reconciles interrupted pre-switch maintenance or rolls back an interrupted
switch. Never remove a live operation/state lock. A stale short settings lock
requires inspecting the interrupted save before removal; no PID-only automatic
lock stealing is implemented.

## Evidence and outstanding integration

The updater regression suite and mocked F1 drive cover policies, settings races,
active-slot draining and queued-step recovery, one controlled worker, preserved
native checkpoint IDs and human gates, failed trial/rollback and independent homes. They use controlled
candidates/supervisors and do **not** establish native OS service behavior or
release publication. The lifecycle lane supplies and separately validates the
owned service/desktop adapter. Final integrated macOS/Linux target receipts,
complete byte-bound integrity/functional evidence and exact-candidate publication
remain necessary before rollout. No publisher signing keys are required.
