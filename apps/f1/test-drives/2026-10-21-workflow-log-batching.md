# Workflow command activity persistence

Date: 2026-10-21. Mode: mocked agents and a real scripted subprocess; no provider inference.

Verbose trusted commands used one full run-state commit per output chunk. Native
agent messages already used the bounded activity batcher. A busy run writer could
therefore accumulate old command snapshots ahead of the final check result and
explicit read/checkpoint barriers.

`WorkflowRuntime.log` now schedules both activity sources through that existing
batcher. Explicit checkpoint saves and flush/shutdown barriers retain their
original behavior. Event contents, provenance and approval obligations are unchanged.

The tested tree starts at `7c7a851223385033d99f0d56ab7bc536e28ddbe9`; exact runtime
and fixture hashes are recorded in
[the sanitized receipt](assets/2026-10-21-workflow-log-batching.json).

## Reproduction and targeted checks

The existing durability test was extended to workflow events. Before the fix,
500 events caused 500 committed notifications rather than one; the agent case
already passed. After the fix, the full runtime and native-message persistence
suites pass: 148 tests. They cover busy writers, complete retained messages,
checkpoint writes, read barriers during continuous activity, restart and shutdown.

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/EdgeWorker.message-persistence.test.ts
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/context-capture-lengths.mjs --workflow-logs
```

## F1 result

The reusable cold-context drive creates a real issue/session through an isolated
EdgeWorker, retains a checkpoint across restart, then runs a shell/Node script
that emits 96 lines and deliberately exits 7. It verifies the failed status and
every line in the durable workflow transcript before an explicit fixture repair
and accepted retry. The second attempt retains the complete normalized command
output and continues into the scoped evidence inspection.

- PASS: 191 actual stdout chunks across both attempts, with 51 commits across
  output, failure/retry, checkpoints and subsequent inspection. This is not a
  timing benchmark or a count of output-only commits.
- PASS: original failed transcript retained; retry follows the explicit repair.
- PASS: complete selected records from 32 cold history rows, with 256 claims each,
  remain exact through stdio MCP; undeclared output is denied.
- PASS: activities remain visible and the final unanswered human decision stays
  pending. The isolated worker is stopped and its temporary home removed.

Initial fixture attempts were corrected to wait for the failed execution's
controller cleanup, expect the retry API's accepted HTTP 202, and respect the
existing trimmed command-output contract. Those were fixture corrections; the
production patch remains the activity scheduling change.

This candidate is not installed in the live worker. Live-run completion times,
real model behavior and provider approvals are not established by this drive.
