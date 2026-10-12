# F1: resumed checkpoints with loaded history

**Date:** 2026-10-12  
**Tested source:** `2fc8fb2a1e5a2e2ff3b8addcc7468867251a72d7` (clean working tree)  
**Mode:** mocked agents and a controlled script; no live inference or production service.

This runtime/session persistence change requires F1. The [driver](assets/persistence-responsiveness.ts) exercises the actual CLI tracker, EdgeWorker, workflow restart, dashboard HTTP routes and explicit answer. It retains 48 large history receipts with 4 MiB strings and 4,000 structured file fingerprints per output, reads every restored receipt, asserts immutable records/outputs, then commits six resumed checkpoints while polling HTTP with a one-second timeout. Historical receipts stay independent of mutable live outputs, and dashboard indexes reuse the accepted prefix.

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/WorkflowRuntime.test.ts
pnpm --filter bobs-factory-edge-worker test:run
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock F1_PERSISTENCE_PORT=3690 bun run apps/f1/test-drives/assets/persistence-responsiveness.ts
```

All **122 workflow tests** passed; the new receipt-isolation regression fails against previous main and passes after the fix. The edge-worker suite passed **150 files / 1,954 tests**, with one existing skip. Normal commit hooks passed repository build, types and lint.

| Measurement | Result |
| --- | ---: |
| HTTP requests during saves | 356 |
| HTTP p99 | 2.378 ms |
| Maximum HTTP latency | 4.525 ms |
| Maximum event-loop delay over the whole drive | 805.603 ms |
| Transcript append payload bytes, excluding manifests | 131 |

The [receipt](assets/2026-10-12-resumed-history.json) records all passed checks, including native conversation retention, pending human gate, lazy activity/dashboard, legacy byte preservation and one explicit answer through completion. Synthetic transcript strings repeat and deduplicate; logical 1 GiB is not a unique-disk benchmark. Event-loop delay covers setup and history reads as well as saves. This source-mode mocked drive does not claim native provider or deployed-instance behavior. Earlier [evidence](2026-10-12-persistence-responsiveness.md) remains unchanged.
