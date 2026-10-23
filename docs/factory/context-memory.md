# Bounded role context

Factory context is a view of a role's declared inputs. It does not replace native
outputs, executed receipts, Check inputs, revision bindings or human decisions.
The current transport exposes `factory-context-memory-v2`; saved workflow graphs,
native conversations and original receipts are retained.

Start with `list_context` at `""`. Read the current named inputs and `/progress`,
then browse relevant ledger IDs and round records. Follow every relevant
`nextOffset` to `null`. The default view recursively limits each subtree to 25
entries, six levels, a 128-node expansion budget, 6,000 serialized characters and
2,000 characters per nested string. A bounded projection can be only a reference;
it never asserts that the original evidence has been read or that history is
complete. Immediate container metadata is still proportional to its entry count.

Large nested values expose `factory-context-ref-v2` with an immutable
`snapshotRoot`, original `fullPath`, type and original character/entry counts.
Browse the path with `list_context`, or read the original with `view="full"`.
Supply the reference's `snapshotRoot` on later calls to reject a reference used
against a different role snapshot. JSON Pointer escaping remains `~0` and `~1`.
Direct string reads return paginated original text. Character pages retain the
existing 12,000 default and 16,000 maximum; listings retain 25 default and 50 maximum.

Generated `/contextMemory/reviewLedger`, `/reviewRounds` and `/latestSteps` are
lazy indexes. They retain every distinct finding, disposition, observation and
chronological review rationale, including old unresolved findings and rejected
corrections. Identical claims are deduplicated with original first/latest paths
and occurrence counts. Browse relevant records and follow their original source
paths. A disposition remains a claim, not independent acceptance. Changed
dependencies, disagreements and pending work still require their existing checks.
An explicitly supplied input named `contextMemory` stays ordinary input.

`view="full"` means the original scoped **agent snapshot**, including existing
machine-fingerprint projections. Runtime-only manifest contents remain private.
Native raw evidence remains owned by the original runtime receipt stores. Neither
a reference, a summary, an equal JSON object nor an authored name grants native
approval, receipt ownership, filesystem access or delivery authority.

The existing private content-addressed snapshot DAG is reused under
`<factoryHome>/factory/context-cache/<run-id-hash>`. Each role has its own immutable
manifest and root. Cleanup releases its temporary transport and bindings while
other roles retain their nodes. Cross-handoff reuse trusts only the runtime's
private `isImmutableJson` marker; mutable inputs, including descendants of a
shallow frozen object, are recaptured. Derived indexes are root-bound and cached
after explicit access. Cold capture processes uncached inputs once; warm capture
still visits current envelope/history membership metadata. No constant-time
whole-run preparation claim is made. This cache is derived, not canonical evidence.

New review baselines record `contextReferences` for original runtime-owned history
ranges instead of copying their payloads. References bind the run, exact range and
qualified receipt-index digest. Native input construction restores the original
cutoff before native checks/digests; missing, changed or foreign ranges fail.
Projected repository history is never replaced with an unprojected source range.
Legacy inline baseline contexts remain readable and are not rewritten or pruned.
The new representation is recorded on each newly created baseline; it changes no
accepted graph, impact policy, reviewer selection, native thread or approval.

See the [controlled comparison and mocked runtime drive](../../apps/f1/test-drives/2026-10-23-bounded-role-context.md)
for measured sizes, preparation work, pagination, restart outcomes and limitations.

New reference-bearing baselines require a runtime that understands `contextReferences`. Reverting to an older runtime is not a supported reader for those new records; retain a compatible runtime and the original receipt store. No deployment or downgrade is performed by this repository change.
