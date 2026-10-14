# Question choices after review-baseline integration

Date: 2026-10-13. PR: [#118](https://github.com/JappyJan/bobs-factory/pull/118).

Tested HEAD `f7f1594718c2c6d576a6a8277a952f3e00c6e5f0` with pending merge from
`ef01f788b9132f2eddbbc7c2171634ff9dbc59e8` and the fixture fix below.
Tracked binary diff SHA-256 before adding this report and changelog entry:
`0d72e613defaf180fdb985eb7769df6d52642d6ddf932544c63ba641972c988b`.

The merge preserves question choices and adds main's immutable restored review
baselines. Its only conflict was resolved by keeping both changelog entries.
The first question-choice drive failed because its snapshot preceded asynchronous
simulated notification delivery: the restored receipt added `delivered: true`.
The fixture now waits for exactly one completed question receipt before taking
the snapshot. The full receipt comparison and duplicate-notice checks remain.

## Validation

- `pnpm --filter 'bobs-factory...' build`: passed, including runtime and web types.
- `F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker exec vitest run test/SpecialistReview.test.ts test/WorkflowRuntime.test.ts test/ReviewRecovery.test.ts test/Incremental.test.ts test/Questions.test.ts test/FactoryProvenance.test.ts test/FactoryPush.test.ts test/EdgeWorker.factory-mcp-oauth.test.ts --maxWorkers=1`: 247 tests passed.
- Biome checks on the affected TypeScript and fixture files, plus whitespace checks: passed.
- `F1_AGENT_MODE=mock F1_PERSISTENCE_PORT=3690 bun run apps/f1/test-drives/assets/persistence-responsiveness.ts`: passed. Restart retained the pending human gate and native session identity. Twelve loaded review baselines reused payloads across six checkpoints; one explicit HTTP answer resumed the workflow. Dashboard probes completed within the fixture's one-second deadline.
- `F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/tmp/choices-playwright/node_modules/playwright/index.mjs F1_EVIDENCE_DIR=<evidence directory> node apps/f1/test-drives/assets/question-choices-mock.mjs`: passed after the receipt timing fix. Defaults, custom text, keyboard selection, request recovery, unchanged restart, changed-metadata invalidation, stale-answer rejection, notification deduplication and an existing-session ticket reply were exercised. Each completed answer resumed one simulated agent turn and one receipt step.

Inherited `BOBS_FACTORY_*` values were removed from both fixture subprocesses.
Complete logs and generated captures are retained at
`/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161/ci-merge-20261013-1509`.

## Limits

Agents and tracker delivery were simulated. Browser execution used explicitly
headless Playwright; this report makes no new screenshot-inspection claim.
The persistence strings repeat and deduplicate, so that fixture establishes
logical-history behavior rather than unique-disk throughput. Real-agent answer
quality, live tracker delivery and physical-device behavior remain unverified.
New-head provider CI and independent review remain pending. The PR stays draft;
human approval remains required.
