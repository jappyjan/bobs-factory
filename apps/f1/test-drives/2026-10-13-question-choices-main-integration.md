# Question choices after latest main integration

Date: 2026-10-13. PR: [#118](https://github.com/JappyJan/bobs-factory/pull/118).

## Revision and behavior

Tested managed worktree HEAD `81bd551416f8acfb548c7b1a85e4aa02886be732` with pending merge from `6e99eec3536f4144f1bd88b6feb32e49e83829ca`.
Tracked diff SHA-256 before adding this report: `dc785f0d0766ae2943fb6faed57617bf4ae546da38d577509f9b8f13451a57be` (`git diff HEAD --binary`).
Web build: `306c9205c496c1c9079360f6`.

The merge retains question-choice instructions alongside accepted frozen-workflow guidance and Notifications in Settings. No question-choice interaction was intentionally changed. Per the F1 applicability policy, the shared runtime and interface integration was exercised with the existing simulated-agent question fixture.

## Commands and results

- `pnpm --filter 'bobs-factory...' build`: passed.
- `pnpm --filter bobs-factory-f1 build`: passed.
- `pnpm typecheck`: passed.
- Nine focused runtime suites (Questions, WorkflowRuntime, WorkflowExecution, FactoryProvenance, FactoryPush, prompt-assembly.routing-context, EdgeWorker.factory-mcp-oauth, EdgeWorker.capture-recovery, FactoryPwa): 274 tests passed.
- `pnpm --filter bobs-factory test:run src/tui/tui.test.ts`: 16 tests passed.
- `node --test apps/desktop/test/desktop-path.test.mjs`: 3 tests passed.
- Conflict-resolved TypeScript Biome checks and `git diff --check`: passed.
- `F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/tmp/choices-playwright/node_modules/playwright/index.mjs F1_EVIDENCE_DIR=/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161/ci-merge-20261013-1245 node apps/f1/test-drives/assets/question-choices-mock.mjs`: exit 0. Inherited `BOBS_FACTORY_*` values were removed from the fixture subprocess environment; embedded runners are simulated.

## Executed assertions and evidence

The fixture created isolated issues, worktrees and runtime state. It exercised declared defaults, no-default incompleteness, custom text without fallback, mode switching and draft retention, keyboard selection, request recovery, explicit submission, restart persistence, changed-metadata invalidation, stale-answer refusal, notification deduplication and an existing-session ticket reply. Each completed answer resumed one simulated agent turn and one receipt step. The worker shut down cleanly.

Evidence and complete command logs: `/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161/ci-merge-20261013-1245`. Inspected `choices-dashboard-defaults.png` and `choices-custom-mobile.png`: defaults/custom controls and explicit Send answers remain readable in desktop and 390-pixel mobile captures. The remaining three fixture images are retained without an inspection claim.

## Limits

Browser execution was headless Playwright. Agents and tracker delivery were simulated. Real-agent answer quality, live tracker delivery, physical terminal behavior and background device notifications remain unverified. This merge validation supplements prior accepted evidence; new-revision provider CI and independent review remain pending after push. Human approval remains required and the PR stays draft.
