# Question choices after workflow and update integration

Date: 2026-10-14

Validated the merge of feature parent `7b0276dee2f6c33a3e7680daf76ed2c8e2267744` and main `bfe71f41`, before committing. The conflict resolution retains both terminal test groups, updates capability guidance for bundled workflow preferences and explicit Resume, and preserves question-choice guidance and full prompt expectations.

Checks passed:

- `pnpm --filter 'bobs-factory...' build`
- `pnpm typecheck`
- Focused edge-worker suites: Questions, WorkflowRuntime, WorkflowCatalog, FactoryProvenance, FactoryPush and full routing-context prompt assertions: 192 tests.
- Terminal suite: 18 tests, including choice drafts, late options, complete question context and blocked-workflow Resume.
- Biome checks on resolved TypeScript files and `git diff --check`.
- `F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/tmp/choices-playwright/node_modules/playwright/index.mjs node apps/f1/test-drives/assets/question-choices-mock.mjs`, with inherited Factory origins removed and evidence directed to the run directory: exit 0.

The isolated fixture exercises issue creation, question notification, choices/defaults/custom drafts, explicit browser submission, unchanged restart receipt retention, changed-choice batch notification and an existing-session ticket reply. Both browser and ticket answers resumed one simulated agent turn and one receipt. All embedded agents and title jobs are simulated; no provider credits were used. The fixture shuts down its worker and application server.

Evidence: `/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161/ci-fix-20261014`. Inspected `choices-dashboard-defaults.png` and `choices-custom-mobile.png`: defaults and separate custom mode remain readable, and the mobile form wraps without horizontal overflow. Logs are retained alongside the evidence.

This validates integration behavior, not real-agent suggestion quality or physical-device notification display. Provider CI and renewed human approval apply to the pushed revision.
