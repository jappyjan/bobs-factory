# Saved-run recovery during pending ticket delivery

Scope: EdgeWorker preparation and persisted WorkflowRuntime recovery. External
ticket delivery is a controlled unresolved promise; agents use F1 mock handlers.
No production tracker or model calls are made by this drive.

Run from the repository root after building:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/ticket-backlog-recovery.mjs
```

The unpatched runtime at `44a927fc` fails with “Saved work blocked behind pending
ticket delivery”. With the fix, the same restarted workflow completes while its
historical delivery remains pending. The drive uses the real EdgeWorker prepare
hook and real script execution, with a saved checkpoint whose completed first
step would fail if replayed.

Assertions passed:

- Pending external delivery does not prevent saved execution from resuming.
- The completed step is not rerun; its output and history remain intact.
- A retained native conversation ID survives recovery.
- The historical delivery receipt remains pending rather than being discarded.
- A later delivery rejection is recorded and does not fail completed work.

The standard Vitest suite `EdgeWorker.ticket-recovery.test.ts` additionally uses
the real TicketTracking service with both native and Taskbot references in
isolated projects. Both cases fail with the original blocking preparation and
pass with the fix. They verify shutdown while publication is pending, durable
failure receipts, and successful retry with the same delivery ID after another
restart, without replaying completed work. These tests run with the normal
package test command.

The recovery, existing TicketTracking and EdgeWorker MCP suites pass (53 tests).
This controlled drive does not establish live tracker delivery or native agent
behavior; production recovery is verified separately on the local instance.

After merging current main, the expanded recovery/tracking/MCP/auth/access/web
checks also pass (106 tests), along with EdgeWorker and CLI type checks and the
rebuilt F1 recovery drive.
