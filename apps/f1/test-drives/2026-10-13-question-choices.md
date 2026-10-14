# Factory question choices: simulated-agent test drive

Date: 2026-10-13. Goal: transport and explicitly submit single/multiple choice answers in both Factory interfaces without treating defaults as authorization.

## Revision and setup

- Base HEAD: `043eea7e540090e97261ae688ca470c6aefeddac`; implementation is uncommitted in the managed worktree.
- Tracked diff SHA-256: `9051549dc3fcd43103dbd8ee22f94c0df747217b0cf6ef55197be696108b96fc` (`git diff HEAD --binary`; excludes this new report and the new fixture).
- Fixture SHA-256: `e64804682a42ac15b412dc48a360526b2b3f71ead85e722e09d8244d5cf4bf80`.
- Tested web asset build: `c5fd7e3218f3074af431d452`.
- Isolated temporary Git repository and Factory home, CLI issue tracker, bounded instance pool, simulated Codex runners including background titles. No provider credits or real tickets were used.
- Authentic headless Chromium screenshots were inspected. The installed agent-browser 0.27 screenshot command timed out; the fixture uses Playwright with `headless: true`. Each browser case opens a fresh browser context to preserve direct loopback navigation guards.

## Commands and results

```sh
pnpm --filter 'bobs-factory...' build
pnpm --filter bobs-factory-f1 build
pnpm --filter bobs-factory-edge-worker test:run test/Questions.test.ts test/WorkflowRuntime.test.ts test/FactoryServer.test.ts test/FactoryPush.test.ts test/FactoryProvenance.test.ts
pnpm --filter bobs-factory test:run src/tui/tui.test.ts
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory typecheck
F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/tmp/choices-playwright/node_modules/playwright/index.mjs F1_EVIDENCE_DIR=/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161 node apps/f1/test-drives/assets/question-choices-mock.mjs
```

The CLI dependency build, F1 build and both package type checks passed. The five targeted edge-worker suites passed 188 tests; the terminal suite passed 14. The added push identity assertions passed in a subsequent focused run of its 13 tests. Biome checks on changed code passed with 17 pre-existing stylesheet warnings and no errors. `git diff --check` passed.

## Drive assertions

- The mixed four-question batch carries single selection, multiple selection, a legacy recommendation and free text through the issue tracker, EdgeWorker, runtime and dashboard.
- The dashboard shows exactly the declared defaults. The second browser case has no single-choice default and remains incomplete after the other questions are answered. Keyboard selection is explicit.
- Checkbox toggles work with Space. Custom mode focuses a separate empty text field; blank text cannot borrow defaults. Switching modes preserves text and selections. An unchanged runtime save preserves drafts.
- Desktop and 390-pixel mobile layouts keep options and reasons readable, with no horizontal overflow. Send answers remains visible. A mobile checkbox width problem found during the drive was fixed before the successful capture.
- A recoverable HTTP request failure keeps the answer drafts and does not resume work. The next explicit Send answers resumes one simulated clarification turn and one receipt step.
- Selecting “Explain using examples” is submitted as an answer. The custom case submits only “A custom strategy” for that question. Multiple answers appear once, in declared option order. The existing-session ticket reply also resumes exactly once.
- A full worker restart retains the unchanged choices, empty answer history, batch ID and exact question notification receipt. Changing only an option reason before another restart creates a fresh batch, records one additional question notification and rejects the old contextual answer.
- Targeted runtime tests additionally exercise nested waits across restart, explanation with omitted choice metadata, metadata-only source changes, clearing after answers and existing architecture/review authorization guards. Schema and resolver tests reject invalid IDs/indices/defaults, overlapping metadata and invalid single selection. Terminal screen/key tests cover radio replacement, independent toggles, custom mode, explicit Ctrl-S, short-terminal scrolling and sanitization; launch-form tests remain passing.

## Evidence and limits

Runtime evidence is retained in `/Users/jappy/.bobs-factory/factory/evidence/manual-118888b6-4280-4d53-b419-f0d0ec390161`:

- `choices-mock-path.json`: simulated role inputs/outputs, waiting/completed snapshots and command results.
- `choices-mock-commands.json`: issue creation, session, reply and activity-page commands.
- `choices-dashboard-defaults.png`, `choices-dashboard-custom-defaults.png`: default and no-default states.
- `choices-custom-mobile.png`, `choices-dashboard-selected.png`, `choices-dashboard-custom-selected.png`: mobile custom mode and desktop selection/custom modes.

Real-agent generation quality, live Linear/Taskbot delivery and physical terminal/device behavior remain unverified. Simulated tracker receipts and the terminal screen/key harness establish transport and interaction behavior, not those live behaviors. There is no originating ticket or PR for this implementation step. Publication and review remain the next workflow steps.
