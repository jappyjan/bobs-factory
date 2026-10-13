# F1: resumed specialist review baselines

Date: 2026-10-13. Source: changes on `t3/fix-desktop-resource-usage`, based on
`6e99eec3`. Mode: mocked agents and a controlled script; no live inference.

This runtime persistence/review change requires F1. The retained
[driver](assets/persistence-responsiveness.ts) now seeds 12 large review baselines
alongside its existing 48 history receipts, restarts the actual CLI-platform
EdgeWorker, reads every restored baseline, and saves six resumed checkpoints
while polling the dashboard with a one-second timeout. It verifies frozen scope
evidence, newest-round selection, chunk reuse, retained conversation IDs and the
pending human gate, then answers that gate through HTTP and checks completion.
All repositories, homes, worktrees and ports are isolated from the local instance.

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/SpecialistReview.test.ts test/WorkflowRuntime.test.ts test/ReviewRecovery.test.ts test/Incremental.test.ts --maxWorkers=1
F1_AGENT_MODE=mock F1_PERSISTENCE_PORT=3690 bun run apps/f1/test-drives/assets/persistence-responsiveness.ts
```

All 178 focused tests passed. Before the fix, the two regressions fail because
recent-review lookup reads an unrelated cold history chunk, and a checkpoint
rewrites an already-read unchanged baseline. After the fix, recent matching
history remains readable without touching the cold prefix, and baseline payloads
survive checkpoint/restart without rewriting.

The [receipt](assets/2026-10-13-review-baseline-resources.json) records:

- 366 successful dashboard probes; p99 1.96 ms, maximum 5.76 ms.
- 702 new payload bytes across six resumed checkpoints after reading all 12 baselines.
- 131 new transcript payload bytes for an append after 1 GiB of logical history.
- Maximum event-loop delay across setup, history reads and the drive: 933.69 ms.

The strings repeat and deduplicate. These figures validate logical-history
scaling and orchestration, not unique-disk throughput or the exact production
heap peak. The local instance was recovered separately with affected jobs
stopped; this drive does not claim deployment of the fix or native provider/UI
validation. Existing historical reports and receipts remain unchanged.
