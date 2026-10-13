# Impact review fixes: saved QA provenance and grouped feedback

Date: 2026-10-13. PR: [#124](https://github.com/jappyjan/bobs-factory/pull/124).
Implementation revision: `5937c0cee491fe000a6a1337a34c733f082c3b4b`.
The native drive ran the compiled runtime changes before committing that revision.
Agent mode: simulated agents only (`F1_AGENT_MODE=mock`); no provider credits used.

## Changed behavior and assertions

QA criterion provenance is now stamped during capture finalization, before the
runtime saves output/history or creates review hashes. Gates validate saved
provenance without rewriting execution dates or original evidence.

Grouped feedback assessment traverses each repository delivery, checks the exact
comment body hash and saves repository-scoped comment IDs. Feedback fingerprints
include comments, threads and reviews from every repository receipt.

## Checks

- Edge-worker build and typecheck passed.
- Commit hooks ran the monorepo build and typecheck successfully.
- Targeted Biome checks and `git diff --check` passed.
- Five relevant suites passed: **76 tests** across Impact, FeedbackPolicy,
  FactoryRepositoryScope, SpecialistReview and Incremental.

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock \
  pnpm --filter bobs-factory-edge-worker test:run \
  test/Impact.test.ts test/FeedbackPolicy.test.ts \
  test/FactoryRepositoryScope.test.ts test/SpecialistReview.test.ts \
  test/Incremental.test.ts
```

The grouped feedback regression uses two deliveries with identical provider
comment IDs. Bare ambiguous assessments and missing repository assessments are
rejected. Serialized history projects into each repository after restart; assessed
comments stay settled, edited comments become outstanding again, and changes to
threads/reviews change the digest. Reordering deliveries does not change it.

## Isolated native EdgeWorker drive

Started the actual compiled EdgeWorker with a fresh Factory home, disposable Git
repository, local bare origin and non-default `release` target. Injected F1
MockAgentRunner for every agent and background title. Used the protected manual
API to launch an impact workflow with scope, capture, independent QA review and
QA gate stages before and after a teardown correction.

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock \
  BOBS_FACTORY_FACTORY_PORT=4813 bun <evidence>/review-fixes/native-qa-drive.mjs
```

Run: `manual-1cb467f8-8c65-45a9-bb0f-aecaac0ea84a`.
The first capture executed a Node authorization assertion. Its saved historical
criterion contains runtime source, dependency, environment and execution
provenance. The second capture reused the original criterion after an unrelated
teardown correction. Assertions verified the exact original provenance, original
criterion digest, saved final output and successful QA gate. The authorization
specialist ran once, affected specialists ran twice, and both capture stages ran.
No prior human approval existed. The server stopped and its temporary home,
worktrees and repository were removed.

An initial driver assertion matched only nested `/capture` history keys and
missed this workflow's plain `capture` keys. The driver was corrected and the
complete native drive passed. The focused unit fixture also needed the normal
`changedFiles` progress array; all five suites passed after that fixture correction.

## Limits and retained evidence

Simulated agents validate orchestration and evidence handling, not real model
judgment. Grouped feedback validation exercises runtime assessment/history
projection with controlled provider receipts; it does not contact remote forges.
No production deployment, real provider merge or paid agent call was performed.
There are no changed browser views in this correction.

Driver, native logs, results, cleanup receipt and complete targeted-test output:
`/Users/jappy/.bobs-factory/factory/evidence/manual-2bd6b169-9864-4eba-be58-afcc28fbd1c6/review-fixes/`.
