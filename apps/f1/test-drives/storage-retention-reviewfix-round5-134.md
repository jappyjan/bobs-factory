# Storage retention: cleanup after restoring paged history

Date: 2026-10-21. PR: [#164](https://github.com/jappyjan/bobs-factory/pull/164).
Source: the commit containing this report, based on `3faaa348`.
Earlier reports and failed receipts remain unchanged.

## Changed behavior and assertions

The dependency scan validates each assessment and command receipt at its trusted
runtime location when traversing that loaded record. It no longer enrolls the
whole history in one pass and assumes those objects survive a second pass.
Exemptions stay local to the current record and still require the owning run's
impact decision and configured workflow location. History, current outputs,
frozen review context and nested checkpoint outputs use the same classification.
The existing bounded traversal and snapshot cache remain in place.

All five delivered-workspace fixtures now save more than four one-entry history
pages and restart the real WorkflowRuntime before inspecting dependencies. They
assert that snapshot-cache eviction recreates the first history object. The scan
must permit cleanup through manual, ticket, nested, grouped and Takeover routes,
while preserving retained output, unfinished native work, arbitrary copied
assessments/receipts, cross-run file references and evidence symlinks. Copies in
arbitrary history entries are also checked as live dependencies.

## Reproduction and verification

The manual-route restart regression failed against the original production code
at `3faaa348`: the final dependency scan incorrectly retained the workspace. The
same focused scenario passed after the correction. This reproduction preceded
the extra assertions for arbitrary history copies; the workspace regression
command exercises the final source.

`pnpm -r --no-bail test:run` passed in 319 seconds with simulated agents,
workspace concurrency one and up to four Vitest workers. All 17 F1 scenarios
passed, including the five restored-history delivery routes; 3,942 Vitest tests
passed across the workspace. The receipt confirms both changed source files
remained unchanged throughout execution. Existing optional skips remain.

Evidence in the supplied run directory:

- `reviewfix-r5-baseline.log`: expected failing reproduction against original code.
- `reviewfix-r5-focused.log`: passing focused restart scenario.
- `reviewfix-r5-reproduction.json`: reproduction conditions and limitations.
- `reviewfix-r5-workspace.json` and `reviewfix-r5-workspace.log`: full workspace
  regression result, source fingerprints and simulated-agent configuration.

## Evidence limits

F1 uses simulated agents, isolated homes and real local Git with controlled
provider delivery proof. Stock delivery scenarios resume retained reviewed
checkpoints; they do not establish a new stock planning run, real-provider
continuation or human approval. This correction changes no UI. Independent
reassessment and later delivery gates remain separate workflow obligations.
