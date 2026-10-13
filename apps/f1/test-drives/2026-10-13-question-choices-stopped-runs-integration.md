# Question choices after stopped-run integration

Date: 2026-10-13. PR: [#118](https://github.com/jappyjan/bobs-factory/pull/118).

## Tested revision

Managed worktree HEAD `55c799eccf5bd3fb421ec12f0a1b12cea3851b6b` with pending merge of main `0621f759e506badbaf46a090de2884651a76608e`.
Tracked diff SHA-256 before adding this report: `4e6856f4bd81d8c937191f260085f1a31f594832ef1355155fe0b34147f7929a` (`git diff HEAD --binary`). Web build: `27009f45bdcba7e58a1d7d2b`.

The only textual conflict was in CHANGELOG.md; all entries were retained. Shared runtime, terminal and dashboard files merged automatically. Validation checks that the existing question-choice behavior survives integration with stopped-run resumption. No new question behavior was introduced.

## Commands and results

- `pnpm --filter 'bobs-factory...' build` and `pnpm --filter bobs-factory-f1 build`: passed.
- `pnpm typecheck`: passed.
- Seven focused runtime suites (Questions, WorkflowRuntime, WorkflowExecution, FactoryPush, FactoryProvenance, FactoryAccess, FactoryWebClient): 212 tests passed; the real IPv4/IPv6 loopback API/stream test timed out, including cleanup. Its isolated retry with `pnpm --filter bobs-factory-edge-worker test:run test/FactoryAccess.test.ts -t 'serves real IPv4'` passed in 4.78 seconds. The initial failure is retained; its intermittent cause is not established. No test timeout or assertion was weakened.
- `pnpm --filter bobs-factory test:run src/tui/tui.test.ts`: all 16 tests passed.
- Biome checks of the six automatically merged TypeScript files and `git diff --check`: passed.
- `F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/tmp/choices-playwright/node_modules/playwright/index.mjs F1_EVIDENCE_DIR=/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161/ci-merge-20261013-2045 node apps/f1/test-drives/assets/question-choices-mock.mjs`: exit 0. Inherited `BOBS_FACTORY_*` values were removed from test subprocess environments; embedded runners and title jobs were simulated.

## Executed behavior and evidence

The fresh fixture exercised single and multiple choices, declared defaults, incomplete-answer guards, custom text without default fallback, mode switching and draft retention, keyboard selection, request recovery, explicit submission, restart persistence, changed-choice invalidation, stale-answer rejection and notification deduplication. Dashboard submissions and an existing-session ticket reply each resumed one simulated agent turn and one receipt. The worker shut down cleanly.

Complete logs, snapshots, command receipts and screenshots are in `/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161/ci-merge-20261013-2045`. Inspected `choices-dashboard-defaults.png` and `choices-custom-mobile.png`: default choices, separate custom fields and explicit Send answers remain readable on desktop and mobile. Other captured images were not inspected in this step.

## Limits

Browser execution used explicitly headless Playwright. Agents and tracker delivery were simulated. Real-agent answer quality, live tracker delivery, physical terminals and background device notifications remain unverified. The loopback test had one intermittent local timeout before its passing isolated retry. New-revision CI, independent review and renewed revision-bound human approval remain the runtime's next steps; this step did not merge or change the PR's ready status.
