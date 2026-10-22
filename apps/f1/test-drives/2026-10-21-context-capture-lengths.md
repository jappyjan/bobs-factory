# Cold context capture without redundant node reads

**Date:** 2026-10-21. **Result:** PASS. **Mode:** mocked/scripted, no inference.
**Base:** `a4990127173a9135b331bbe7956559321a0087e2`.
Exact candidate source hashes and sanitized measurements are in
[the evidence receipt](assets/2026-10-21-context-capture-lengths.json).

Watching recovered runs exposed repeated long pauses before native agents started.
The worker was responsive and still preparing retained history. Capture computed
each child's serialized length, then reopened and hashed its private node file to
retrieve that same length. Repeated cold records evicted the small reader cache.
The fix retains only calculated lengths during a capture and clears them on
completion or failure. Normal readers still verify stored bytes. Snapshot format,
declared scope, evidence and approval requirements are unchanged.

## Reproduction and direct checks

```sh
git show a4990127173a9135b331bbe7956559321a0087e2:packages/mcp-tools/src/factoryContextSnapshot.ts > /tmp/bobs-context-before.ts
pnpm --filter bobs-factory-mcp-tools build
node --experimental-transform-types apps/f1/test-drives/assets/context-capture-benchmark.mjs /tmp/bobs-context-before.ts
node --max-old-space-size=64 apps/f1/test-drives/assets/context-handoff-memory.mjs
```

The benchmark captures 32 independently decoded copies of 256 findings:
1,155,363 JSON characters. Instrumented original/candidate runs measured
49,687/zero node-file reads and 4,976/1,337 ms. The committed public benchmark,
without instrumentation, measured 5,479/2,000 ms. Both compared every captured
character and reopened the cold snapshot with identical results. These are local
fixture measurements, not a promise about total live-run startup time.

The existing shared-history check also passed: 1,133,497,580 logical characters,
996,217 transport bytes, preserved selected complete receipts/native identities,
and a maximum heartbeat gap of 10.94 ms. It requested a 64 MiB old-space limit;
this Node runtime reported a 256 MiB total heap limit and 117 MiB peak RSS. This
checks shared-history scaling rather than unique-data throughput.

## Relevant F1 workflow

```sh
pnpm --filter 'bobs-factory-f1...' build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/context-capture-lengths.mjs
```

A fresh local EdgeWorker creates an issue/session and reaches an unanswered
checkpoint. An isolated synthetic checkpoint supplies distinct repeated records
in saved history and declared outputs. After a worker restart, the original
question is retained until an explicit fixture answer. The real role handoff and
stdio context server then verify complete first/middle/last records in both
declared collections, following all selected pages. Undeclared output is denied.
The scripted role stops at a new unanswered human decision; its assistance is
visible in session activities. The worker shuts down cleanly. No provider call,
production state write, live worker restart or installation occurs.

The fixture uses current output-name scoping and waits for asynchronous restored
questions/activity delivery. Earlier fixture attempts exposed those harness
assumptions; the historical audit-context drive also uses a retired auth schema
and was left unchanged. The final drive passed every assertion.

The MCP package's 82 unique tests passed across the package run and a focused
operator rerun. Two stdio tests initially lacked the compiled CLI; after building
it, both operator files passed all 15 tests. F1/dependency and CLI builds, changed
file lint and whitespace checks passed. Live runs still use the installed nightly;
this evidence validates the candidate fix rather than claiming deployment.
