# Improve codebase: research, per-item actions and independent Factory handoff

**Date:** 2026-10-20
**Changed behavior:** bundled `improve-codebase` discovery with no task prompt, bounded coordinator/worker research, iterative choices, deferred issue filing and independent Factory runs.
**Source:** implementation worktree based on `dd0b591a480593d6b9952b0e1e5acadba574ee23`; changed files are in the accompanying commit.
**Agent mode:** deterministic mocked provider via F1 `MockAgentRunner`. No native inference API, paid model run, production tracker write or Git-provider delivery was performed.

## Drive

```sh
pnpm --filter bobs-factory-mcp-tools build
pnpm --filter bobs-factory-edge-worker build
bun apps/f1/test-drives/media/2026-10-20-improve-codebase/drive.ts
```

The script starts a real embedded EdgeWorker and protected Factory server on localhost:3600 with a fresh Git repository, CLI tracker dependency and mocked native runner events. The issue adapter is scripted. Every requested provider is intercepted, including titles. It stops the worker in `finally`.

Assertions passed:

- Empty task input launches discovery; eight perspective coordinators each delegate a bounded cheaper-model worker assignment. All research configs expose only scoped context/repository tools, with native editing and delegation disabled.
- No issue or implementation child exists before human acceptance.
- A protected follow-up request produces a second retained proposal and fresh targeted worker research. It does not silently choose Fix.
- Preparing mixed Fix / File issue / Ignore choices creates a reviewable exact manifest without writes or child launches.
- Applying that manifest files one deferred issue through the scripted adapter and creates exactly one independent stock Factory run. The issue-only and ignored items produce no implementation runs.
- The child has a separate Git worktree, retained parent identity and ordinary Factory definition. Its normal clarification gate waits for user input; parent acceptance does not fabricate a child human delivery approval.
- The parent remains waiting while its selected child is undelivered.

Recorded passing run: `manual-4fe7567d-d733-4b43-b2a3-4eb836c434fd`; independent child `improve-5931494c723c5efda71afc01e49c5df737b08c7b`; fixture home `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-improve-codebase-cOFeQ8`. Console result: `PASS`, 9 workers including follow-up, 2 proposal versions, 1 issue, `humanGateRetained: true`.

## Dashboard and targeted checks

A second mocked instance was inspected through the collaborative browser. All four per-item actions, current/historical proposal versions, before/after designs, issue destination and exact batch counts rendered. Changing a choice disabled Apply and required preparing the changed batch again; restoring it enabled Apply. Browser Apply produced one issue and one child, with no run for Ignore. Desktop and 390px mobile layouts had no horizontal overflow. Mobile before/after designs use one column. The final layout and waiting labels were checked after rebuilding.

Focused regression coverage additionally verifies sixteen workers with two assignments per perspective; simultaneous independent fixes; dependency release only after exact approved delivery; stale choice rejection; preserved choices and native child identity across restart; issue response-loss reconciliation for Linear and Taskbot; partial tracker failure without blocking independent fixes; Bob history sampling, legitimate waits and sanitized error categories; and pinned repository reads excluding symlinks, private paths, working-tree drift and writes.

[Desktop proposal](media/2026-10-20-improve-codebase/proposal-desktop.png) · [Mobile proposal](media/2026-10-20-improve-codebase/proposal-mobile.png)

## Limits

Evidence proves orchestration, HTTP guards, persistence, projections and mocked runner lifecycle. It does not establish live model research quality, provider pricing/availability, live Linear/Taskbot creation or a real merged PR. Dependency delivery uses scripted exact-revision receipts in targeted tests. Operational collection initially supports retained repository-matched Bob histories and tracked evidence; arbitrary live log/database connectors are not part of this implementation. Research budgets bound work/time, not billed currency. Existing workflows and native credential stores retain their normal behavior.
