# Recipe side-effect actions

Snapshot, File issues and Launch runs can be used in any recipe, including Call
recipe and For each bodies. Configure them in Recipes using the action settings
panel. JSON Pointers use the same safe, bounded data rules as For each. Mappings
are data selectors, with no scripts, expressions or credential values.

```json
[
  {"id":"baseline","name":"Snapshot","type":"snapshot","snapshot":{"history":{"lookbackDays":30,"maxRuns":100}},"next":"research"},
  {"id":"research","name":"Research","type":"agent","prompt":"Inspect the pinned baseline and return items with id, title, body, labels, prompt and dependencies.","reads":{"baseline":"baseline"},"access":"read-only","revision":"bound","output":{"format":"json-v1"},"next":"file"},
  {"id":"file","name":"File issues","type":"file-issues","fileIssues":{"items":{"from":"/research/items"},"fields":{"title":"/title","body":"/body","labels":"/labels"},"destination":{"provider":"taskbot","server":"taskbot","instance":"https://taskbot.example","project":"example"}},"next":"launch"},
  {"id":"launch","name":"Launch runs","type":"launch-runs","launchRuns":{"items":{"from":"/research/items"},"workflow":"factory","inputMapping":{"prompt":"/prompt"},"dependencies":"/dependencies","wait":false},"next":"end"}
]
```

Use actual configured destination coordinates. The example does not create a
tracker connection or grant tool access. A recipe author chooses which items to
file and launch; filing an issue alone never schedules its implementation.

## Snapshot repository

Snapshot pins the tracked HEAD commit of **every** repository in the run's
retained scope. `revision` is that commit for a single repository or a stable
scope digest for grouped repositories; `repositories` retains each exact commit.
The output also retains the original observation date, safe history and limits.
Private roots remain runtime state. Uncommitted changes and untracked files are
excluded. Snapshot roots must identify distinct exact Git roots.

A read-only agent declares a named read of the whole Snapshot output. A caller
may pass it through an explicit Call recipe input mapping; the reusable callee
reads that input with `@callInputs/<name>` without naming the caller's step.
Private persisted runtime receipts carry the original run, producer, lexical/item
frame, scope/revision/digest and accepted mapping hops. The runtime verifies those
receipts and frozen mapped inputs, then exposes only committed regular blobs at
those revisions. Nested calls and For each preserve the original authority. A whole Snapshot
selected from a completed Call output or For each result retains its exact
producer through the original runtime result receipts. Ordinary copied or literal
equal JSON does not acquire that authority. A copied agent result cannot
mint snapshot or publication authority. Pinned tools deny private-looking paths,
symlinks, other repository IDs and arbitrary filesystem access. They allow at
most 200 calls, list in pages and read at most 16,000 characters per response;
agents must report uninspected scope honestly. Reads of older commits remain
bound to that snapshot even when the mutable worktree later advances.

Optional history matches the full repository scope and includes dated status,
step transitions and bounded attempt metadata, with classified errors. It never
copies raw logs, prompts, credentials, account identities or error text. Defaults
are 30 days and 100 runs; configurable maxima are 365 days and 1,000 runs, with
at most 50 transitions and 30 attempts per run. Sampling is explicit.

## File issues

`items` selects an earlier output array or an inline `values` array. `itemId`
defaults to `/id`; unique safe string IDs and `maxItems` (100 default, 1,000
maximum) are validated before sending. `fields.title`, `body` and optional
`labels` are pointers relative to each item. Unknown mapping fields cannot set
status, assignee or delegation.

The accepted destination must match an accessible configured tracker. Linear
uses workspace/team and optionally project IDs; Taskbot uses the configured
server, instance and project. When discovery has exactly one option it may be
omitted; otherwise select a destination explicitly. There is no inferred
cross-project default. Native Linear filing retains the accepted Legacy native
integration; explicit profiles cannot silently borrow those credentials.

The runtime persists all mapped intents before sending and the provider adapter
persists `sending` before creation. Linear uses a deterministic UUID and exact
body marker, explicit backlog, null assignee/delegate and no default template.
Taskbot uses exact body/label markers and explicit backlog. Confirmations verify
the original identity, destination, backlog/unassigned state and requested
labels. Provider defaults cannot assign work or start an agent. Output `tickets`
is keyed by accepted item ID and retains confirmed IDs/links.

On Retry or restart, confirmed receipts remain unchanged. Sending becomes
uncertain and reconciles the original provider identity. Several matches,
changed markers, a lost receipt or an invisible uncertain Taskbot request require
operator reconciliation; no title-only deduplication or blind resend occurs.
Partial successes remain available in retained `issueActions`. Restore access
and use Retry to recheck original intents, rather than editing accepted state.

## Launch runs

The target defaults to `factory`. It and every resolved indirect Call recipe or
Launch runs target must allow the **workflow** trigger. A manual permission does
not substitute for workflow permission; disallowed targets reject without
fallback. Cycles through resolved recipes and active parent/call ancestry are
rejected before dispatch, including private fork aliases.

Each accepted item retains its target and resolved definitions, mapped `prompt`
and optional `plan`, repository subset, model/settings and execution profile.
`inputMapping.repositoryIds` may select unique IDs from the parent's accepted
scope; it cannot expand that scope. The accepted execution profile is inherited,
including Legacy, rather than reselected from later defaults. Each admitted child
is an ordinary independent run with its own worktree, normal recipe gates and a
safe Part of link. Parent instructions never approve a child's delivered PR.

An optional dependencies pointer selects item IDs. Unknown, duplicate, self and
cyclic dependencies fail before creating children. Waves open only after each
original prerequisite completes with exact current human approval and
provider-confirmed merge receipts for every relevant grouped repository.
Ordinary output flags, automated approval, pending merge or uncertain provider
state cannot satisfy them. Failed/cancelled prerequisites or completed children
without that proof leave explicit blocked dependents. Repair and resume/retry
the original child, then Retry the failed parent; retained identities remain.

Each action execution has a durable identity independent of retries and loop
visits. All original child IDs and accepted inputs persist before creation;
creation/persistence uncertainty reconciles that exact child before dispatch.
No child launches until its own durable save completes.

With `wait:true` (default), the action passively tracks children and returns their
terminal outcomes. With `wait:false`, it returns reserved child links promptly
and later recipe steps proceed. Durable background reconciliation continues
later waves after the action returns and across restart. The parent remains
waiting while child outcomes are unresolved; blocked outcomes fail the parent.
A reserved link does not assert that its queued child already exists or merged.
Mutable `launchActions` progress never rewrites original step outputs/receipts.
Passive child/human/provider waits hold no execution or shared mutation lease.

Normal **Stop** durably pauses future parent dispatch and leaves children working.
Observation of original child identities, outcomes and provider proof continues,
including after restart. It updates operational progress without creating or
admitting queued children, changing the stopped parent, or rewriting accepted
outputs. Already-admitted children may resume their ordinary work after restart.
**Resume** reconciles unfinished original children and queued waves, including
when the recipe graph already ended. **Stop batch and active runs** persists
cancellation intent before stopping the parent/children and covers pending or
uncertain creation identities after restart. It permanently cancels that batch;
resuming the parent does not relaunch it. Completed children/receipts remain.
The run page exposes waves and queued/launched/running/waiting/merged/completed/
blocked/cancelled/uncertain states. Legacy `improvementParent` links retain a
deterministic compatibility fallback; replacing Improve belongs to a later task.

## Delivery plan binding compatibility

Runtime-supplied `deliveryCandidateDigest` resolves the accepted declared plan
read selected by `scope-inputs.sources.plan`, including stock and frozen presets
whose read is named `scopePlan`. Existing declared `reads.plan` partners remain
supported. This never falls back to a step named `plan` or activates delivery
from an output format or ordinary data. The reviewer echoes the supplied digest;
the acceptance action still requires the exact current contract digest. Wrong
or stale reviews reject. Accepted definitions, original receipts and native
conversation identities are retained without rewriting.
