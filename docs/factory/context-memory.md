# Outputs-first role context

New runs record an accepted `roleContext` policy at admission. The default is
`{ "mode": "outputs-first" }`. A recipe's `context` and an agent's `context`
may configure a scoped diagnostic exception. Called recipes retain their own
configuration; names, providers and repository identities do not select behavior.
Saved definitions stay unchanged. A saved copy and a new run adopt different
policy; restored accepted runs without the adoption receipt retain legacy inputs.
Simple keeps its supported native conversation.

Start with `list_context` at `""`, then follow the response's `handoffPath`
(normally `/handoff`). A named user input is never overwritten: collisions select
another advertised path. The handoff contains the original task, exact human
answers, decisions and steering with run/path or message identity, declared
structured inputs and artifacts, repository scope, current revision/delta and
specific missing-source gaps. Accepted requirements, constraints, findings,
dispositions, disagreements and rejection rationale stay at their original
sources. Existing output schemas and native evidence checks retain validation.
A summary or authored `approved` label cannot create human or provider authority.
A necessary missing record names its binding and targeted remedy; restore it or
ask that question instead of reconstructing scope from every message. Human Ask
explanations keep their existing displayed-data-only scope and native profile.

`run.history` is structured output/receipt history, not an assistant message
buffer. Generated `/contextMemory/reviewLedger`, `/reviewRounds` and `/latestSteps`
retain every distinct historical finding, disposition, observation and review
rationale. Identical claims keep original first/latest paths and occurrence counts.
A disposition remains a claim, not independent acceptance. Preserve unresolved
work and use current native checks to assess reopening or acceptance.

The serving projection remains `factory-context-memory-v2`. Browse relevant
named inputs, `/progress` and ledger records. Follow relevant `nextOffset` values
to null. Recursive limits stay 25 entries, six levels, 128 expanded nodes, 6,000
serialized characters and 2,000 characters per nested string. Large values expose
`factory-context-ref-v2` with immutable `snapshotRoot`, original path, type and
counts. A descriptor is an index, not evidence read. Supply `snapshotRoot` on
later calls to refuse references from another snapshot. JSON Pointer escaping
remains `~0` and `~1`. Read pages default to 12,000 characters and cap at 16,000;
listings default to 25 entries and cap at 50.

`view="full"` recovers complete **permitted structured evidence** within the
agent snapshot, including existing compact machine fingerprints. It does not
bypass transcript restrictions. Direct reads/listings of restricted sources,
scalar aliases, nested inline copies and full exports containing raw transcripts
are refused. Compact parents show a restricted descriptor without the body.
Derived ledger aliases retain original source provenance. Arbitrary domain JSON
named `history`, `messages`, `approved` or `contextMemory` remains ordinary data;
its names neither classify it as a transcript nor establish native authority.

## Diagnostic exceptions and cumulative bounds

A diagnostic role declares its purpose, exact original role/message range and
allowance in its accepted recipe configuration, for example:

```json
{
  "id": "inspect-response",
  "name": "Inspect one original response",
  "type": "agent",
  "prompt": "Diagnose the declared original response; preserve missing evidence.",
  "context": {
    "mode": "outputs-first",
    "transcripts": {
      "purpose": "Recover the original failed tool response",
      "ranges": [{ "role": "predecessor", "start": 3, "end": 4 }],
      "utf8Bytes": 65536,
      "pages": 8,
      "extension": { "utf8Bytes": 32768, "pages": 4 }
    }
  },
  "reads": { "excerpt": "@transcripts/roles/predecessor/3/entry/content" }
}
```

Ranges are half-open, zero-based positions among original session entries carrying
that runtime-owned `factoryStepKey`, in the current accepted run. Escape `/` in a
qualified role key as `~1` in the read pointer. Unattributed legacy entries do not
acquire guessed roles. Missing original session data or an unavailable range
produces a source-specific recovery error. The bounded activity log is not a
replacement transcript. Ordinary roles never request the native buffer, including
when attempting a forbidden `@transcripts` read. Diagnostic selection stops when
all requested endpoints are reached, without touching later entries.

Before detachment/snapshot capture, the existing streaming serializer preflights
the selected original entries against the recorded byte allowance. An oversized
range is refused without cloning it, recording a capture gap and exact counters.
Select a narrower range, supply an explicit excerpt artifact, or request a configured
bounded extension. There is no silent truncation or whole-history fallback.
Each successful transcript read then reserves its exact UTF-8 page payload bytes
and one page **before** materializing/returning it; transcript listings also consume
the allowance. Repeated pages, aliases, new snapshots, MCP reconnections and native
resume of the same run/qualified role share one durable receipt. Disconnects do not
refund reservations. Response-envelope bytes remain separately measured by the
existing diagnostics counters. No token, inference-time or cost value is inferred.

Allowance receipts live beside existing per-run context snapshots at
`<factoryHome>/factory/context-cache/<run-id-hash>/transcript-<work-hash>.json`.
They contain counters, scope and at most 32 bounded extension records, without raw
messages. Include them in complete-home backup/restore; deleting accounting files
is unsupported and does not authorize a new allowance. A busy/abandoned accounting
lock requires inspecting/restoring that owned work, never resetting counters or
assuming a read passed. This is not arbitrary process-crash certification.

The existing operate-authorized `retry_run` accepts optional `transcriptExtension`
with `work`, `reason`, `expectedPages`, `expectedUtf8Bytes` and `expectedGrants` from
the refusal. It still requires a fresh inspection revision and eligible failed
work. It grants only the configured bounded increment for that same purpose,
run/role/range and records its reason. Stale counters, changed accepted policy,
foreign scope and unconfigured extensions refuse. Context MCP tools cannot extend
themselves. Already permitted reads need no repeated human confirmation. This
reuses existing operator authorization/retry; it does not replace native tool
permissions, progress budgets, review, QA, human decisions, provider CI/readiness
or final-delivery proof. Denied/unread evidence never approves work.

## Original evidence and compatibility

Runtime transcript provenance is private metadata from the original session-entry
owner, not a JSON-key heuristic. It follows object and scalar aliases through
native binding/scope mappings and detached reads. Native review baselines retain
`contextTranscriptSources` beside #144's `contextReferences`; reconstruction
restores those exact source identities before agent projection. Original native
Check/digest inputs and receipt stores are not replaced by the filtered view.
Opaque legacy/domain data is not promoted into authoritative transcript or decision
evidence by its labels. A missing necessary explicit record requires its named
source/targeted recovery. Raw originals, native identities, credentials, accepted
snapshots and pending obligations remain retained.

Transcript-bearing scoped manifests use `factory-context-snapshot-v2`; unmarked
legacy snapshots keep v1, and the current reader accepts both. Older readers
reject new scoped manifests rather than serve a source without its restriction.
New source-table baselines need a compatible runtime. No deployment or downgrade,
active-run migration or native-conversation rewrite is performed here.

## Reused immutable context owner

The existing private content-addressed snapshot DAG is reused under
`<factoryHome>/factory/context-cache/<run-id-hash>`. Each role has its own immutable
manifest and root. Cleanup releases its temporary transport and bindings while
other roles retain their nodes. Cross-handoff reuse trusts only the runtime's
private `isImmutableJson` marker or verified immutable transcript entry sources.
The latter bind the native store, saved manifest path, field, index and chunk
hash; runtime-owned slices carry that identity without retaining decoded pages.
Unchanged file device/inode/size/mtime/ctime metadata allows reuse after an entry
has been evicted. Changed files are revalidated against their original chunk and
document hashes. The native decoded cache remains four pages. Derived source-key
caches retain at most 8,192 node IDs per directory/projection mode and 16 modes,
never the receipt payloads. Mutable inputs, including descendants of a shallow
frozen object, are recaptured. Derived indexes are root-bound and cached
after explicit access. Cold capture processes uncached inputs once; warm capture
still visits current envelope/history membership metadata. No constant-time
whole-run preparation claim is made. This cache is derived, not canonical evidence.

New review baselines record `contextReferences` for original runtime-owned history
ranges instead of copying their payloads. References bind the run, exact range and
qualified receipt-index digest. Native input construction restores the original
cutoff before native checks/digests; missing, changed or foreign ranges fail.
Declared `@history` aliases still receive complete mutable detached copies.
Private source-range hints survive that binding seam, but baseline capture checks
the complete copy against its original range before substituting a reference.
Modified/reordered copies stay inline; original receipts remain untouched. This
avoids per-baseline storage duplication, while native cloning and comparison
still visit the declared history. Projected repository history is never replaced
with an unprojected source range.
Legacy inline baseline contexts remain readable and are not rewritten or pruned.
The new representation is recorded on each newly created baseline; it changes no
accepted graph, impact policy, reviewer selection, native thread or approval.

See [the #144 comparison](../../apps/f1/test-drives/2026-10-23-bounded-role-context.md)
and [Task149's scoped mock evidence](../../apps/f1/test-drives/taskbot149-outputs-first.md)
for measurements and retained limitations. Private provenance classification also
keys the derived immutable caches, preventing a previously unclassified cached
node from bypassing a later runtime source classification.
