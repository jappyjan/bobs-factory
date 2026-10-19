# Linear assignment activity delivery during continuous SDK traffic

**Date:** 2026-10-19
**Tested base:** `11e19b471999013455383511439e737de8bc0cf7`, with this checkout's request-budget fix.
**Mode:** deterministic mocked F1 agent and isolated loopback GraphQL provider; no live model or Linear mutations.
**Fixture:** [linear-busy-budget.ts](assets/linear-busy-budget.ts).

The change affects Linear activity delivery during issue intake, so F1 applies.
The fixture mounts the actual signed `LinearEventTransport`, starts the F1
`MockAgentRunner` through `AgentSessionManager` and `LinearActivitySink`, and
publishes through `LinearIssueTrackerService` while direct SDK issue reads
continue without an idle gap. Both kinds of request share a 100 ms budget.

```sh
bun run apps/f1/test-drives/assets/linear-busy-budget.ts
```

```json
{"result":"PASS","mode":"mock","starts":1,"requests":6,"publications":3,"pending":0,"unhandled":0}
```

The signed assignment returns 200. Its acknowledgment and mocked final response
reach the provider while reads continue, with API spacing retained, one runner
start, no pending activity and no unhandled rejection. Cleanup stops polling and
delivery, closes both servers and removes the isolated home.

The focused regression test failed before the fix: issue reads took the next
budget slot and the acknowledgment waited until all reads ended. After the fix,
the acknowledgment takes its queued slot at 2000 ms and delivery completes while
later reads remain queued.

```sh
pnpm --filter bobs-factory-linear-event-transport test:run
pnpm --filter bobs-factory-linear-event-transport build
pnpm exec biome check packages/linear-event-transport/src/LinearRequestBudget.ts packages/linear-event-transport/test/LinearDelivery.test.ts
```

All 72 transport tests pass, including provider throttling, credential rotation,
shared request pacing, priority and durable retry safeguards. The transport build
and focused lint checks pass. This drive establishes mocked orchestration and
actual SDK transport behavior; it does not claim a live Linear assignment passed.
