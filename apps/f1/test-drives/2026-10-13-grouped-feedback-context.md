# Grouped feedback copied from supplied context

Date: 2026-10-13. PR: [#124](https://github.com/jappyjan/bobs-factory/pull/124).
Baseline: `4589ec0b1088da7af8a979817831e8ea8b1d1787`; the drive used the
compiled working-tree correction committed alongside this report.
Agents were simulated (`F1_AGENT_MODE=mock`). No provider credits were used.

The regression test now obtains outstanding comments from `aggregateDeliveries`,
the same function that supplies grouped feedback context. Copying its `id`,
`repositoryId` and `bodySha256` reproduced the review failure before the fix.
The fixed assessment handler accepts scoped IDs and provider IDs with a repository,
rejects mismatched repository identities, and saves canonical scoped IDs.
Restart projection and edited-comment detection remain covered.

Four focused suites passed: **68 tests** across FeedbackPolicy, MergeReadiness,
Impact and FactoryRepositoryScope. EdgeWorker build and targeted Biome checks
passed.

```sh
pnpm --filter bobs-factory-edge-worker test:run \
  test/FeedbackPolicy.test.ts test/MergeReadiness.test.ts \
  test/Impact.test.ts test/FactoryRepositoryScope.test.ts
pnpm --filter bobs-factory-edge-worker build
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock \
  BOBS_FACTORY_FACTORY_PORT=4833 bun <evidence>/native-feedback-drive.mjs
```

The compiled EdgeWorker ran in an isolated home with a disposable repository,
local bare origin and non-default `release` target. Its workflow supplied two
controlled delivery receipts with identical provider comment IDs through
`aggregateDeliveries`. The simulated impact agent copied all three assessment
fields from the resulting context. Both impact assessments completed, and the
runtime saved `a:42` and `b:42` with their respective repository identities.
The drive also retained successful QA gates and the original authorization
criterion provenance across an unrelated teardown correction. No prior human
approval was present. Issue/session startup and final response activities passed.

Run: `manual-000961ee-09e1-418b-acc7-4dd00f5611ab`. The worker stopped and the
temporary home, worktrees and repository were removed. The first driver attempt
omitted required blocker fields from its controlled readiness receipts; it failed
before assessment. Completing those receipts allowed the full drive to pass.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-2bd6b169-9864-4eba-be58-afcc28fbd1c6/review-feedback-fix/`.
It contains the driver, initial and final logs, results and cleanup receipt.

This verifies orchestration with simulated agents and controlled provider
receipts. Real model judgment and remote forge delivery remain untested.
No browser views changed, and no deployment or merge was performed.
