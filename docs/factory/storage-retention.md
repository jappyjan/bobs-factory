# Storage retention

Settings → Storage controls the connected Factory instance. The matching
`bobs-factory --home HOME --port PORT storage` commands use the running instance's
protected terminal session. A browser controls its selected backend, including
when the browser runs on another machine.

## Defaults and preservation

Automatic reconciliation runs at startup, every 24 hours and after coalesced
ownership or terminal-run changes. The versioned policy lives in
`HOME/storage-retention/policy.json`, outside frozen workflow definitions and
saved-state snapshots.

| Category | Default eligibility |
| --- | --- |
| Verified usable rollback snapshots | Keep the newest two at any age. Unprotected overflow is eligible immediately. At least one rollback is mandatory. |
| Unused staged updates and completed preparation | Seven days after verified durable completion and reconciliation |
| Reconciled recovery and migration preparation | Seven days; unresolved recovery, source/native/external backups remain protected |
| Delivered worktrees | Thirty days after verified durable completion, with exact delivery and every owner's release proved |

Preservation wins over every age and count. Pending updates, failed unreconciled
transactions, current/previous executable links, retained rollback dependencies,
unknown ownership and unreadable state retain their data. Protected data can exceed
the configured policy. The low-disk threshold defaults to five GiB per affected
filesystem; it warns and requests ordinary reconciliation without relaxing checks.
Disabling automation leaves previews and selected manual cleanup available.

Worktree cleanup checks the exact repository mapping, Git administration, local
HEAD and fresh confirmation from the accepted Git provider. It retains tracked
changes, untracked files, unique ignored content, nested repositories and uncertain
submodules. Gitignore is insufficient proof of rebuildability. Saved stopped,
failed, waiting, queued and native continuation work stays protected. A completed
run's workspace identity is released only after content/native references are
independently absent and the release is recorded durably. When native lookup
cannot be proven independent of the directory, the directory stays retained.
One protected repository or unexpected parent entry retains a workspace group.

## Preview and clean

```sh
bobs-factory --home HOME --port PORT storage status
bobs-factory --home HOME --port PORT storage preview
bobs-factory --home HOME --port PORT storage clean --preview PREVIEW_ID --ids ID1,ID2
```

Each preview is a bounded page. Continue scanning while it reports deferred work.
A scan slice evaluates at most 100 candidates and 1,000 filesystem entries, or
yields at one second. Large integrity scans retain stream state between slices;
a restart rechecks the manifest rather than trusting saved progress as deletion
authority. Usage scans persist their directory positions. Conservative bounds
are operating choices, not measured performance guarantees. Hooks and Git removal
retain their two-minute and thirty-second execution limits.

Select exact eligible identities. Cleanup returns an operation ID immediately;
status shows progress and retained/failure reasons. A changed preview or policy
requires refreshing. Every target is checked again under updater exclusion,
cleanup ownership and its canonical workspace/group claim. Busy maintenance yields
instead of replacing a worker. Cleanup never creates or restarts a worker.

Policy saves require the displayed revision and a complete JSON policy:

```sh
bobs-factory --home HOME --port PORT storage policy --file policy.json --revision N
```

Settings shows the same controls. Unsaved form edits and selections follow normal
navigation, reload and configuration-change reset rules.

## Historical directories

```sh
bobs-factory --home HOME --port PORT storage historical-preview
bobs-factory --home HOME --port PORT storage classify \
  --preview PREVIEW_ID --candidate EXACT_ID --category staging \
  --operation RETAINED_UPDATE_TRANSACTION_ID --verified-disposable-contents
```

Inspect the exact directory, ownership evidence, originating operation,
reconciliation proof and dependencies first. The explicit election binds to its
preview and filesystem identity. Classification requires a retained completed,
acknowledged producer transaction proving that exact path. It does not enroll
arbitrary external paths or override normal eligibility. A historically elected
snapshot is disposable data, not a newly certified usable rollback; it never
replaces the mandatory retained rollback. Unproven lookalikes remain
retained. Source/native/external migration backups keep their original retention
requirement; a name or successful-looking journal cannot elect them implicitly.
Migration writes observational preparation records, not automatic deletion grants.

## Failures and interruption

Deletion intent is durable before hooks or filesystem changes. Receipts are small
metadata records in `storage-retention/receipts`; prior interrupted receipts stay
in `receipt-history`. They contain no backup contents or credentials. The current
preview and outcome replace previous verbose views, keeping diagnostics bounded.
Inventory publication records an unfinished write before changing ownership. An
interrupted publication fails closed; restore/reconcile its producer records before
cleanup instead of removing the warning or inventing a completion timestamp.

A hook may run just before a crash without a success receipt. Inspect its effects
and verify it can safely run again before selecting **Retry interrupted teardown**
or supplying `storage clean --idempotent-teardown`. This explicit retry does not
waive new files, native references, Git checks, ownership or policy. Hook failures
and newly created user files retain the target. Git removal uses the exact mapping
without force or a recursive fallback. Interrupted partial groups remain protected
when the remaining mapping cannot be independently established.

Update-artifact retries verify every remaining file against the original manifest;
new or changed files retain the artifact. An absent original target can reconcile
its receipt without rerunning hooks or claiming measured savings. A replacement
identity ends the old intent and remains protected. Keep receipts during recovery.

## Measurements and limits

Apparent directory bytes measure file lengths, including link records without
following their targets. Observed free-space change compares the affected volume
before and after a deletion; concurrent writes and APFS/shared blocks can change
that value. It is not a promised number of reclaimed bytes. Missing measurements
are shown as unavailable, and small measurements retain meaningful units.

Cleanup preserves native credential/conversation stores, configuration, run IDs,
accepted definitions and decisions, gates, historical evidence and all retained
manifest chunks. It does not garbage-collect chunks or historical evidence. New
snapshot copies exclude only identity-verified obsolete copies with a verified,
durable replacement and released recovery dependencies. Old synchronous snapshot
helpers remain available for retained validation scripts; production updates use
the cancellable retention-aware copy.

Consumed desktop staging whose installed bundle has moved, unclassified historical
copies and failure-era recovery data can remain protected until their producer is
reconciled. Native-provider continuation and native desktop platform behavior need
appropriate platform validation; simulated-agent tests do not establish those
provider/platform guarantees.
