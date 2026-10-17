# Prepared updates drain passive workflow waits

Date: 2026-10-17. Runtime tested: `b7bd6609` on `54f4714d`.

The local instance had remained in draining for over three hours with zero active
agent slots. A merge step continued provider polling, while ticket flushes accepted
before maintenance continued delivering their retained backlog. Passive waits did
not reach the graph's normal scheduling boundary.

F1 applies to workflow lifecycle and update recovery. The existing maintenance
drive now exercises the actual EdgeWorker, WorkflowRuntime, FactoryTools, protected
FactoryServer drain API and maintenance release/recovery. Provider responses and
execution-profile preparation are controlled; no inference or external mutation
is performed.

```sh
pnpm build
pnpm typecheck
pnpm --filter bobs-factory-edge-worker exec vitest run \
  test/MergeReadiness.test.ts test/UpdateMaintenance.test.ts \
  test/TicketTracking.test.ts test/DeliveryCoordination.test.ts \
  test/UpdateManager.test.ts test/FactoryServer.update-startup.test.ts
F1_AGENT_MODE=mock F1_TESTED_COMMIT=b7bd6609 \
  F1_EVIDENCE_DIR=/tmp/bobs-update-passive-drain-b7bd6609 \
  node apps/f1/test-drives/assets/update-maintenance.mjs
```

All 180 targeted tests passed, along with the repository build/typecheck and
changed-file Biome checks. Before the fix, three passive polling regressions
remained busy, queued ticket delivery sent another receipt after freeze, and a
rejected persistence promise left the delivery barrier busy: five failing checks.
Additional coverage protects grouped suspension, queued repository reservations
and maintenance beginning during transport backoff.

The [F1 receipt](assets/2026-10-17-update-passive-drain/update-maintenance.json)
contains twelve passing observations. CI, merge and handoff finish their current
provider request without cancellation, then acknowledge idle with zero agent slots.
Their current checkpoints and exact approval remain retained. Releasing maintenance
resumes through fresh provider evidence; a merge confirmed remotely is not submitted
again. Existing intake, MCP descendant and retained-session observations also pass.

This drive does not validate native OS replacement, release publication or real
provider execution. Those remain separate release/install checks.
