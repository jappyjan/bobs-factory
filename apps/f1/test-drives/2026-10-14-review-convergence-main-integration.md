# Review convergence and bundled workflow integration

Date: 2026-10-14. Draft PR: [#124](https://github.com/jappyjan/bobs-factory/pull/124).

Tested the merge working tree from `8785e6aa73003df294fc73d05bd9f1abafb49d06` and main `bfe71f418b4df1c0265f6bc837f420a6c8513aa3`, including the conflict resolutions committed with this report.

Bundled workflow ownership replaces in-place recipe migration. New stock launches retain impact assessment; specialist fixtures use conservative steps while registering the current bundled defaults. Saved accepted graphs and native checkpoints remain unchanged.

Command: `F1_AGENT_MODE=mock F1_RECEIPT_PATH=/tmp/manual132-catalog-f1.json bun apps/f1/test-drives/assets/workflow-catalog-129.ts`.

The real EdgeWorker, isolated Git worktrees and protected HTTP API passed migration, forks, dependency gating, blocked restart, native queue interruption, native Resume, attachment/session identity, missing-repository recovery, manual Simple operator Resume and export/import round trip. Receipt result: passed. All provider runners and background title jobs were simulated. Cancellation intentionally produced a stopped-mock message; recovery assertions passed and the server shut down.

Monorepo build and typecheck passed. Lint passed with 19 existing warnings. Impact, catalog, workflow runtime, guide, reader state, web client and complete routing-prompt assertions passed (196 tests); all 31 specialist tests passed after selecting conservative fixture steps. Three non-media video contract/range tests passed. Thirteen media tests were not run because ffmpeg is unavailable.

Initial fixture failures and the corrected independent retests are retained in `/tmp/manual132-tests.log`, `/tmp/manual132-specialist.log`, `/tmp/manual132-targeted.log` and `/tmp/manual132-runtime-migration.log`. Real agent judgment, remote delivery, browser screenshots and Firefox behavior were not revalidated by this integration drive. Downstream review and QA remain required for the new merge revision.
