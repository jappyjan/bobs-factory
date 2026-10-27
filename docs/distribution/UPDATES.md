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
   Passive CI, merge and handoff polling, transport backoff and queued repository
   reservations also yield at saved checkpoints. A provider request already in
   flight settles before the drain becomes idle; recovery reads fresh provider
   state before repeating a mutation. Ticket delivery finishes its current
   receipt and retains later receipts and queued flushes until maintenance ends.
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

Before either state copy, the supervisor estimates the copied roots without
following links and requires their size plus a margin (at least 64 MiB or 10%).
Insufficient space gives a visible cancellation with Settings → Storage guidance.
A small journal reserve allows copy failures such as ENOSPC to record cancellation
and release maintenance and operation ownership while the supervisor stays alive.
An uncertain maintenance release still requires recovery.

Evidence links and links beneath
`factory/execution-private/<run>/jobs/<job>/<runner>/home/` are preserved as exact
link records in snapshots and rollback, and omitted from preflight. Runtime sockets
and FIFOs in those isolated agent homes are skipped. Links and special files
elsewhere in copied owned state are refused; targets are never followed.
Superseded snapshots are reclaimed through [Storage retention](../factory/storage-retention.md),
while the last successful rollback and unresolved update references remain protected.

Protected supervisor hooks are `POST /api/updates/maintenance` with
`{transactionId, action: "begin" | "end"}` and `GET /api/updates/drain`.
The transaction must match persisted updater state. Drain returns idle/busy,
capacity observations and `preservedStateSha256`; these are not unauthenticated
health shortcuts. A reboot with retained maintenance does not automatically
resume workflow/native execution before supervisor reconciliation.

Receipts and candidate state preflight declare `preservationContract:
"factory-preservation-v2"`. This contract hashes the saved workflow catalog bytes,
including local recipes, execution preferences, launch settings and availability.
Bundled workflow code may change with the exact verified candidate; accepted run
definitions, outputs, checkpoints, answers, gates and native sessions still must
match. Hashing the resolved bundled catalog would incorrectly roll back ordinary
prompt fixes, while omitting saved availability and Simple preferences.

Different receipt contracts are not interchangeable. The supervisor rejects a
contract change during isolated preflight, before stopping the current worker.
The first upgrade from a legacy worker therefore needs a deliberate stopped-worker
upgrade through its installation owner: drain active work, retain a complete home
backup, confirm worker/descendant exit, install the verified runtime and restart
under the same owner/home. Older supervisors do not understand this preflight
field and will conservatively roll back the incompatible health receipt. Do not
disable health checks, edit saved runs or remove live locks to force the upgrade.
After the owner-managed boundary, ordinary bundled workflow updates use matching
v2 receipts. Retrying a failed workflow requires the fixed runtime to be running;
staging a candidate or retrying against the older runtime cannot apply its fix.

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

## Storage retention

Settings → Storage and `bobs-factory storage` preview and clean verified owned
artifacts. New runtime staging is registered under `updates/staging`; completed
preflight copies live in `updates/preparation`. Snapshots keep the newest two
verified usable rollbacks at any age, with a mandatory minimum of one. Unprotected
overflow is eligible immediately; other disposable preparation/staging ages at
seven days. Pending/recovery state and executable/rollback dependencies always win.

Runtime and desktop updater exclusion precedes cleanup ownership. Cleanup yields
during maintenance and never replaces or starts a worker. Unknown historical
directories require an exact classification backed by a retained producer
transaction and explicit election. See the [storage runbook](../factory/storage-retention.md)
for policy, interruption recovery and measurement limits.
