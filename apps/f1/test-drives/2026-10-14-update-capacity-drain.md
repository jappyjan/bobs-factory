# Prepared updates drain active capacity

Date: 2026-10-14. Functional source: `23f027e0620117b5831d748d98638a101864ba4e`, based on latest main `0621f759`. Both F1 drives ran after that commit and the repository build/typecheck.

## Applicability and scenario

F1 applies to capacity admission and workflow/session lifecycle. Updates stage before freezing intake or capacity. Once prepared, one maintenance transaction closes admission while active slots finish naturally. Subsequent workflow steps and queued slots retain their checkpoints and ordering, then resume after successful activation or cancellation. Human answers, review gates and native conversation IDs remain retained.

The lifecycle drive uses actual WorkflowRuntime, MachineCapacity, protected FactoryServer APIs and UpdateManager with a controlled replacement/rollback adapter. The maintenance drive starts an actual isolated EdgeWorker with mocked agents, controlled ticket routing and a real scripted stdio MCP descendant. It validates accepted operations across the freeze and preserved ticket receipts after reboot.

## Commands and results

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm exec biome ci
F1_AGENT_MODE=mock F1_TESTED_COMMIT=23f027e0620117b5831d748d98638a101864ba4e \
  F1_EVIDENCE_DIR=/tmp/bobs-update-drain-23f027e0 \
  node apps/f1/test-drives/assets/update-lifecycle.mjs
F1_AGENT_MODE=mock F1_TESTED_COMMIT=23f027e0620117b5831d748d98638a101864ba4e \
  F1_EVIDENCE_DIR=/tmp/bobs-update-drain-23f027e0 \
  node apps/f1/test-drives/assets/update-maintenance.mjs
```

- [Lifecycle receipt](assets/2026-10-14-update-capacity-drain/update-lifecycle.json): ten scenarios passed. An active process exited with code 0 and no signal. Queued fanout work stayed parked with its original sequence; active siblings were not cancelled. Policy cancellation resumed saved steps once. A controlled replacement resumed queued slots and next steps once after health and release, with only one worker at a time. Failed trial health rolled back, preserving answer batches, review gates and mock native session IDs.
- [Actual-worker maintenance receipt](assets/2026-10-14-update-capacity-drain/update-maintenance.json): nine scenarios passed. Protected operator mutations refused during maintenance, stored inspection stayed available, accepted configuration/ticket operations finished before idle acknowledgment, and a real tagged MCP descendant settled naturally under its existing slot. Retained maintenance suppressed startup execution until exact release.
- 342 targeted edge-worker tests across updater, maintenance, capacity, workflow, native/chat recovery, titles and persistence passed. Tests cover staging before admission closes, pause/policy/shutdown cancellation, cancellation during a final checkpoint save, deferred PR input persistence without credentials, and duplicate replay prevention after a native input checkpoint.
- 28 core persistence/capacity tests, 16 CLI lifecycle/snapshot tests and 15 desktop updater tests passed: 401 targeted tests total.
- Repository build, typecheck and Biome CI passed. Biome reported 19 existing warnings. Diff checks passed.
- The two starvation regressions fail against the original main implementations: capacity refuses to freeze while a lease is active, and the updater releases maintenance on its first busy observation. They pass with this change.

## Scope and cleanup

Replacement and rollback are controlled in-process operations, not native OS service or packaged binary activation. No live model execution, release publication or production home changes occurred. Synthetic remote authentication binds the protected lifecycle fixture; no physical passkey ceremony is claimed. The actual worker, runtimes and capacity services stopped, and controlled descendants exited. The published receipt omits the retired fixture lease token; the drive verifies exact lease identity before recording `leaseIdentityVerified`. Historical F1 reports and receipts remain unchanged.

## Latest-main integration before merge

Integrated main `31ee590e78d2664d46f78c92df3afcb48efb619d` in tested commit `68d15f48097109baa0d906eb50c5e2a5a8a363a2`. Workflow catalog blocks and frozen definitions remain enforced alongside update scheduling suspension. Retry fixtures now wait for execution finalization before reentry; restored test runtimes use main's managed shutdown helper.

Repository build/typecheck and 235 focused workflow, ticket/chat/native recovery, runner concurrency and update-maintenance tests passed. Both F1 drives passed again with `F1_TESTED_COMMIT=68d15f48` and `F1_EVIDENCE_DIR=/tmp/bobs-update-drain-main-integration`: [lifecycle receipt](assets/2026-10-14-update-capacity-drain/main-integration/update-lifecycle.json), [worker maintenance receipt](assets/2026-10-14-update-capacity-drain/main-integration/update-maintenance.json). The same controlled-activation limitations apply.

The broader edge-worker run passed 2013 tests across 156 files (one skipped), excluding `Video.test.ts` because ffmpeg is unavailable locally. CI installs ffmpeg and runs the complete suite.
