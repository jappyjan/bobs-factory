# Question choices after unified startup integration

Date: 2026-10-14
PR: [#118](https://github.com/jappyjan/bobs-factory/pull/118)

Validated the uncommitted merge of feature parent `1c5d3694bf5f58cb5698e61182d9f57d00077670` and main `bb024b6f`. The fixture receipt records the feature parent, not the later merge commit. The retained `tested-merge.diff` records the tested source. Conflict resolution preserves choice and native-desktop guidance alongside new startup/ticket-manager guidance, keeps both CSS groups and updates the full routing-prompt expectation.

The F1 fixture now supplies `issueTrackerFactory` instead of relying on legacy `platform: "cli"` and mutating private tracker/sink maps. The same injected tracker survives worker restart. All agent and title runners are simulated; Chromium is headless.

Checks passed:

- `pnpm --filter 'bobs-factory...' build`
- `pnpm typecheck`
- Focused edge-worker Vitest suites (Questions, WorkflowRuntime, WorkflowCatalog, FactoryProvenance, FactoryPush, full routing-context prompt assertions, TicketManagers and factory MCP OAuth): 214 tests.
- `pnpm --filter bobs-factory exec vitest run src/tui/tui.test.ts`: 18 tests.
- Biome checks on the resolved TypeScript files and fixture; fixture syntax and whitespace checks.
- With inherited Factory origins removed: `F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/tmp/choices-playwright/node_modules/playwright/index.mjs F1_EVIDENCE_DIR=<evidence directory> node apps/f1/test-drives/assets/question-choices-mock.mjs`: exit 0.

The isolated drive creates issues, displays predefined defaults and custom answers, requires explicit browser submission, preserves unchanged question receipts through restart, rejects stale choice batches and accepts an existing-session ticket reply. Each browser/ticket answer resumes one simulated agent turn and produces one receipt. Inspected the desktop defaults and mobile custom screenshots: controls and text remain readable, and custom mode is separate from choices.

Evidence directory: `/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161/ci-fix-20261014-2045`. It retains command logs, snapshots, screenshots and the tested diff. An initial pnpm command accidentally selected the whole edge-worker suite; it was stopped after unrelated failures and is retained as `tests.log`. The corrected focused invocation passed. This is not a full-suite pass.

Real-agent suggestion quality, live tracker delivery and physical-device notifications remain unverified. Provider CI and renewed human approval apply to the pushed revision.
