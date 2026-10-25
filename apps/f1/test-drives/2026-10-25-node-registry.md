# Factory node registry and cold checkpoint recovery

**Date:** 2026-10-25  
**Result:** PASS  
**Mode:** deterministic mocked agents, real embedded EdgeWorker, protected Factory
HTTP routes and disposable Git repository/home. No live inference or external
tracker/provider mutations.

The refactor changes workflow schema dispatch, execution and builder metadata, so
relevant F1 validation applies. The tested working tree is based on
`5d5f2760f0fb40557669d5ba54a22f687c70e48f`.
[The receipt](assets/2026-10-25-node-registry.json) records exact candidate source
hashes, the completed run and every output's resolved-input digest.

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/node-registry.ts
```

[The fixture](assets/node-registry.ts) registers a test-only node, publishes its
serializable builder metadata through recipe configuration, then launches an
accepted recipe through the protected API. Assertions cover:

- Snapshot captures the disposable repository.
- Foreach executes two isolated item frames and hashes their distinct named reads.
- Check evaluates those reads; Fanout joins two registered-node branches.
- A workflow call maps a produced value into a child Check and projects its result.
- Show continues and Approve blocks for explicit human consent.
- A cold worker restart retains completed receipts and the pending approval;
  explicit API approval resumes without repeating completed steps.
- Empty File issues and Launch runs batches retain their existing action records.
- A mocked agent completes the final step, runtime activity exposes the step, and
  all completed outputs carry an input digest in immutable history.
- Workers stop and the successful disposable fixture is removed.

Focused compatibility verification: 554 tests passed in the initial 33-file run;
two API-backed tests initially lacked the not-yet-built web `current.json`.
After the web build, the entire affected file plus FactoryServer, FactoryWebClient
and the new NodeRegistry suite passed (4 files / 102 tests). The registry/editor
subset subsequently passed (4 files / 30 tests). The edge-worker build, server/web
typecheck and changed-code Biome checks passed.

The older Improve drive references a module removed on current main, so this
fixture directly exercises the refactored execution paths instead. This drive
uses manual workflow launch; it does not claim ticket-assignment routing,
visual browser QA, live provider behavior or nonempty external side effects.
Existing Action/Improve/Human/Foreach/Check tests cover their retained contracts;
the registry suite separately verifies uncertain-effect reconciliation across a
cold runtime restart without a duplicate provider send.
