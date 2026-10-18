# Impact feedback correction and retained source recovery

Date: 2026-10-18. Working tree based on `d4e4abab`. Mode: deterministic mocked
agents; no agent CLI, inference API, live tracker or real merge was invoked.

## Applicability and reproduction

F1 applies to Factory agent validation, saved native-conversation recovery and
impact freshness. The focused regressions failed before the patch: both new and
saved impact outputs accepted a ticket comment until graph processing failed,
and an inventory citing its assessor failed with `Impact decision is stale`.

The maintained driver is
`apps/f1/test-drives/assets/impact-feedback-recovery.mjs`. Run after building the
workspace dependencies and edge worker:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/impact-feedback-recovery.mjs
```

## Scenarios and assertions

A real CLI-platform EdgeWorker used a fresh unrelated Git repository and isolated
home, RPC port 3600 and dashboard port 3540. F1 `createIssue`, `startSession` and
`viewSession` RPCs exercised issue routing, worktree creation and activity output.
All runners, including background title jobs, were deterministic mocks.

- A fresh independent assessor incorrectly claimed an originating ticket notice
  as PR feedback. Runtime validation supplied the rejection and exact feedback
  context to a bounded correction in the same native conversation. Only the
  corrected assessment entered history.
- Requirement extraction cited `/outputs/assess-impact/rationale`. The real
  selected-check tool passed, and the configured coverage reviewer executed.
- A failed run retained completed agent output with that same invalid comment,
  existing review evidence and the self-referencing inventory. After saving,
  stopping and reconstructing the worker, the supported dashboard Retry endpoint
  resumed `retained-impact-conversation` for one correction turn.
- The new assessment reused the original requirement inventory without extraction,
  passed selected checks and executed fresh specialist review. Both workflows
  reached a later assistance checkpoint. No human approval was synthesized.
- Restart preserved prior history and check receipts. Source evidence remained
  anchored to the assessment preceding inventory extraction, even though the
  current assessor output had changed.

Result: **passed**. Eight total role turns: five for the fresh issue and three for
recovery. The recovered run performed no requirement-extraction turn. Both
selected checks returned exit code zero. Shutdown released both listeners.

Local evidence: `/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-impact-feedback-V167hI/`
contains `receipt.json`, full runs, supplied contexts and activities. Driver log:
`/tmp/assessment-f1.log`. This scripted evidence establishes orchestration,
validation, preservation and routing, not native model interpretation.

Focused regressions also verify that edits to the original retained source still
change the fingerprint, unrelated nested histories cannot replace that source,
custom live requirement sources still invalidate assessments, and incorrect
hashes/repository scopes remain rejected. The nightly pipeline now executes this
same F1 driver and includes its actual log in candidate-bound checks.
