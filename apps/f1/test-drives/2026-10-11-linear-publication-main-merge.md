# Linear publication and current ticket delivery — Taskbot #101

Tested the merge of PR #73 head `8c63090c97f933d54a30732ea98a33e3f4cca590`
with main `65dfa97b8e18e308e4ab5255596514ffba341f7b`.
This report and fixture correction are committed with that merge.

The conflict resolution preserves Linear publication purposes, native completion
responses, readable delivery documentation, and main's external delivery and
background tracking. Status application respects superseded milestones and its
persisted receipt even when equivalent documentation already exists. Both branches'
capability text and complete prompt expectation remain synchronized.

## Validation

- `pnpm --filter 'bobs-factory-edge-worker...' build` passed.
- `pnpm --filter bobs-factory-edge-worker typecheck` passed.
- 268 focused tests passed across tracking, external ticket delivery, workflow
  runtime, Linear activity sink, complete routing prompts, Factory tools/pipeline,
  accepted role publication and decision documentation.
- Biome and `git diff origin/main --check` passed.
- `F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-publication-101.ts"`
  passed. The fixture now explicitly waits for background ticket tracking after
  execution completes; its original publication assertions remain unchanged.
  It verified one explicit decision comment, ten native lifecycle comments,
  zero routine progress comments, one completion response, all four modeled
  provider states, auth/select signals, nested/parallel outcomes, zero restart
  duplicates and zero unhandled rejections.

Evidence logs are `/tmp/b0997420-merge-{build,typecheck,tests,publication-tests,worker-tests,f1}.log`.
Agents and Linear transport in this drive were simulated. No real agents or
provider credits were used. Previously accepted actual Linear screenshots remain
historical evidence at their original revision; they were not recaptured here.
Fresh CI and review remain required for this merge revision. PR #73 remains draft.
