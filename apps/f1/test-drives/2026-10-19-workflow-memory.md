# F1: responsive workflow history and bounded context handoff

**Date:** 2026-10-19  
**Source:** implementation working tree based on `11e19b471999013455383511439e737de8bc0cf7`; the [receipt](assets/2026-10-19-workflow-memory.json) records SHA-256 hashes of the tested source files.  
**Mode:** deterministic mocked roles and controlled scripts, isolated temporary homes and repositories, real EdgeWorker, tracker RPC, protected HTTP routes and compiled stdio MCP server. No live inference or production mutations by these fixtures.

The reported dashboard outage recurred while a large saved workflow was active. Workflow input preparation, context transport and native-message persistence change runtime behavior covered by F1, so relevant end-to-end validation is required. This payload is assessed against the previous published nightly's source, `11e19b47`; it changes these runtime paths and their fixtures, with no dependency changes.

## Mechanisms and changes

- Creating a role input used `structuredClone` on all saved history, forcing lazy pages into memory before the role read any evidence. Input snapshots now preserve immutable shared subtrees and fixed history cutoffs; mutable live values remain isolated. Incremental progress and repository projection stay lazy.
- Context handoff serialized the complete input into one JSON string, then parsed and cloned it in the child before producing a compact view. An indexed private snapshot now stores deduplicated nodes and bounded string chunks, yields during preparation and serves exact original paths/pages without a complete parse or stringify. Full historical `baseline.context`, digests and native session IDs remain available.
- Routine native messages bypassed the activity coalescer and queued independent captured saves. They now coalesce; initialization, result and explicit checkpoint writes retain durable barriers. Per-run read barriers wait for their invocation state without requiring later streamed output to stop; global flush still drains scheduled saves, including messages arriving during writer settlement.

Repeated retained review baselines produced quadratic logical history growth in the controlled fixture. Existing baseline construction already strips nested old `baseline.context` when freezing a new baseline; exponential recursion was not established. These checks prove concrete amplification mechanisms, not attribution of every byte of the observed production memory footprint.

Read-only Git history traces the graph clones, whole-input handoff and direct message saves to MVP PR #1 (`38a8f10f`, `37d1631f`, `20c6797a`). PR #32 retained specialist baselines; PR #42 added compact browsing after a child clone. PR #4 batched activity logs but left the direct message-save callback, and PR #102 introduced asynchronous encoding with call-time captures. Later immutable-history work removed other copies while these upstream paths remained. The preceding dashboard API fix, PR #157, did not introduce these paths.

## Workflow drive

The maintained [API responsiveness fixture](assets/api-responsiveness.ts) retains its previous dashboard, answer, retry, evidence and guarded settings checks. It now resumes a saved question into a role with large retained history. The mocked role opens the generated MCP configuration through the real SDK stdio client and reads original Unicode evidence through both full and paged paths. HTTP version probes run during continuation and role preparation.

```sh
F1_AGENT_MODE=mock F1_API_PORT=3704 \
  F1_API_RECEIPT=/tmp/bobs-factory-workflow-memory-f1-final.json \
  bun run apps/f1/test-drives/assets/api-responsiveness.ts
```

All 13 assertions passed. The fixture retained 57,603,120 logical history bytes, read a complete Unicode marker with `view="full"` plus a bounded 31-character page of original notes, and answered 626 version probes; the maximum observed version request was 50.64 ms. Timings describe this local mocked run and are not production latency guarantees. The worker and isolated fixture were shut down afterward.

The maintained architecture approval continuation and impact feedback recovery drives also passed sequentially with the indexed transport. Their original expectations remain; only context loading was adapted. An initial concurrent invocation collided on the fixtures' shared port 3600 before the impact server started; the isolated sequential drive passed.

## Bounded memory proof

```sh
node --max-old-space-size=64 apps/f1/test-drives/assets/context-handoff-memory.mjs
```

The portable [controlled driver](assets/context-handoff-memory.mjs) represents 1,133,497,580 logical UTF-16 JSON characters using repeated shared evidence. The prior monolithic serialization shape exceeds V8's single-string limit. Indexed handoff passed with `--max-old-space-size=64` (a 64 MiB V8 old-space limit), 112.56 MiB peak process RSS and 996,217 bytes of deduplicated snapshot files. Preparation yielded 78 times to the heartbeat; the maximum observed heartbeat gap was 11.33 ms. Every character of three selected original receipts, at history indexes 0, 256 and 511, was compared in bounded pages, together with their native IDs and root boundary pages.

This measures repeated logical-history scaling, not gigabytes of unique on-disk evidence or live provider behavior. V8 old space is one portion of its heap; the driver also records the total V8 heap limit and process RSS.

Two independent smaller regressions establish the other mechanisms:

| Check | Before | After |
| --- | --- | --- |
| Actual cold WorkflowRuntime launch with 16 retained history pages | 32 history decodes before the role hook: 16 for legacy activity markers and 16 for cloning | Zero history decodes before the hook; original page hashes preserved |
| 40 routine messages while an initial encoder is blocked | 41 captured saves, including the initial explicit save | One capture while blocked, two total after release and flush; latest activity, output and native ID persisted |
| Dashboard read requested at marker 1 while later streamed writes continue | The read stayed pending through committed markers 1, 2 and 3; returned only when the stream stopped at 4 | The read returned after marker 1 committed while marker 2's encoder was still held; global flush subsequently persisted marker 4 |

A separate **pre-fix** 32-message blocked-writer experiment grew from 100.0 MiB heap to 303.6 MiB, then returned to 102.6 MiB after draining. That last number is a drained baseline measurement, not an after-fix heap claim.

## Validation and limits

Repository build and typecheck passed. Core tests (247), MCP tests (80, including real compiled stdio operator recovery), CLI tests (231), capture recovery tests (41) and focused workflow/projection/review regressions passed. Independent runtime and context/security reviews found no remaining actionable issues; review fixes and their final source hashes are retained in the implementation and receipt.

The final finite-batch persistence follow-up passed 130 workflow/message tests, including three real-store dashboard stream cases. A broader edge-worker run passed 2,206 tests but hit two default one-second wait timeouts: the capacity queue poll and review-recovery completion poll. Their focused files then passed 15/15 and 2/2; the timed-out capacity test also left pending work touching its deleted temporary home. Capacity/GitService/test sources are unchanged from the base. No test expectations or timeouts were changed to obtain those focused passes; complete remote CI remains a merge gate.

The snapshot tests cover exact JSON/UTF-16 paging, reopen, malformed/private file boundaries, foreign handles, JSON serialization hooks, complete original paths and compact review memory. Workflow tests cover lazy input access, immutable sharing, mutable input isolation, fixed history cutoffs and six specialist branches. Persistence tests cover bounded captures, explicit lifecycle barriers, flush and writer settlement.

This drive does not claim live inference, a production soak or elimination of every possible source of memory pressure. Historical evidence, hashes and native conversation stores were not rewritten. The new runtime must be published and installed before the paused production workflow is resumed.
