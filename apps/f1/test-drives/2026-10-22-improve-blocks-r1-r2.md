# #141 combined R1/R2 repair evidence

The authoritative independent report2306 found **two P2 defects** on immutable
475452bad967645dd0170e7a55d6d004ba990972: incomplete approved-plan transfer (R1)
and producer/view bounds that could strand accepted outputs (R2). That candidate
is historically **NOT CLEAN**. This packet records implementation repairs, not
independent acceptance. Original reports, screenshots, failures and receipts remain.

PR: [178](https://github.com/jappyjan/bobs-factory/pull/178).
Actual checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`,
branch `taskbot/141-improve`; fresh origin/main remains92cdb8227468a596686fc7cdcc1ef06a0894c4af.
Node24.21.0 / pnpm10.33.1. Parent owns statuses, fresh review and guarded merge.

## Corrections

**R1:** stock Launch runs now maps `plan` from the complete canonical `reviewText`,
which contains prose, criteria, dependencies and paths. This is an ordinary recipe
binding. LaunchRuns runtime, stable proposal/plan/child identity, dependency waves,
accepted mapping/digest and pending/uncertain history are unchanged.

**R2:** existing generic component limits remain unchanged. The format library
uses those actual shared schemas at the producing agent:

- Summary16000, title300, proposal body8000, each proposal detail4000, limitation
  detail2000. Limitations use a short generated label plus the complete detail;
  a201-character limitation is accepted and displayed in full.
- Plan prose8000, title300, and complete rendered criteria/dependencies/paths
  details4000 each. Approval binds prose and all three details. Canonical packages
  over8000 total characters remain complete; oversized individual fields fail
  producer parsing through normal OutputValidationError correction. No truncation.
- Joined check-display feedback also validates against the existing markdown
  schema at producer parsing. Pure legacy `improvement-*` data formats retain
  their original schemas. No special Improve runtime, step-ID authority or new
  permission/renderer exception was introduced.

Consolidate/Refine prompts state the bounds and require retaining essential
requirements during correction. Capability instructions and their complete prompt
expectation were updated. The complete role fixture changes only eight base/runtime
entries for those two roles;631/639 entries are unchanged, including every frozen
legacy entry and the original579 protected entries. No native history was edited.

## Focused verification

- Changed composed runtime case: **1passed** in the initial22.24s combined command, with the original90s timeout.
  Criteria and `src/owner.ts` now exist **only** in structured fields. Two packages
  have7980-character prose and complete canonical text over8000. Actual approved
  cards, accepted launch intent, child `input` and `launchInputs` match exactly in
  both dependency waves. Existing Ask/no-research-replay, failed checks/refine,
  Request changes, stale answer, restart, human/provider proof, original receipts
  and side-effect assertions remain. The child delivery is explicitly controlled
  in this runtime test; the separate F1 drive uses installed stock Factory.
- `pnpm --filter bobs-factory-edge-worker exec vitest run test/ResearchFormats.test.ts test/prompt-assembly.routing-context.test.ts`:
  **22passed**. All projected fields are checked at/beyond their receiving bounds,
  including30 limitations, five proposals, five full plan packages, joined details,
  whitespace normalization, producer error class/original output/path and legacy
  data-format compatibility. The complete capability prompt is asserted.
- `test/FactoryRolePrompts.test.ts`: **2passed**, full639-entry comparison after
  deliberate regeneration of the eight changed role entries. No partial prompt
  assertion was substituted.
- `pnpm exec tsgo -p packages/edge-worker/tsconfig.json`: **exit0**, owning edge
  TypeScript emission for the actual drive. No separate repeated type/build cycle.
- Initial combined focused command had the composed case pass and nine new
  boundary assertions fail because a test expected Error.name to equal the class
  name. OutputValidationError inherits Error.name. Fixed the new test to assert
  the actual class, original output and precise issue path; no product assertion,
  outcome/security safeguard or timeout was weakened. Original log retained in
  `/tmp/taskbot141-r1-r2-focused.log`; compact command results are alongside receipts.

## Actual EdgeWorker/F1 correction and transfer

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --review-fixes --serve
```

The scoped mode reuses the existing disposable real EdgeWorker/runtime/HTTP mock
harness. Its real catalog fork changes the research list to one perspective and
uses the ordinary editable Launch runs target to select installed stock Factory;
the copied reachable closure is retained. This exercises the same stock mapping
and schemas without replaying the already-supported eight-perspective/CLI scenarios.
The original mode's scenario body is moved unchanged into `completeDrive()`.

Actual provider invocations reject a2001-character limitation and8001-character
plan at their producers. The next mock provider turns receive the original
rejected output and issue paths, then return corrected output. Decide displays
all201 limitation characters. Refine produces7980 characters of prose with criteria
and paths only in structured fields. The complete canonical package is **8097
characters**, displayed as prose plus details and transferred byte-for-byte to
the accepted launch item and stock child's input/launchInputs. Stale approval
returns409; exact explicit approval admits one stock child with its own worktree,
waiting at clarification with zero child human decisions. No issue is filed.

Two extra one-perspective runs retain actual changed Decide/Approve waits for UI
capture; they use normal short plans. No raw data is silently truncated. The mock
provider deliberately returns a shorter replacement for its rejected fixture
padding; the parser retains/rejects the original rather than shortening it.

Receipts: [repair-r1-r2](media/2026-10-22-improve-blocks/repair-r1-r2/), especially
[actual correction/approval/child proof](media/2026-10-22-improve-blocks/repair-r1-r2/repair-proof.json),
[results/source identities](media/2026-10-22-improve-blocks/repair-r1-r2/results.json),
[turns](media/2026-10-22-improve-blocks/repair-r1-r2/turns.json) and
[cleanup](media/2026-10-22-improve-blocks/repair-r1-r2/cleanup.json).
All selected runtime sources stayed unchanged during the drive. Repeated accepted
catalog definitions are retained as exact JSON SHA-256 hashes; accepted items,
canonical task text, correction outputs and approval content remain complete.
The collector was subsequently changed only to emit that compact metadata, with
syntax/format checks; workflow execution/assertions were not changed or replayed. PID36203 was the
only retained driver; SIGTERM stopped it, all four runs and the worker.

## Changed UI and limits

[Eight actual captures/DOM receipts](media/2026-10-22-improve-blocks/repair-r1-r2/ui/receipts.json):
Decide limitations and expanded Approve details at desktop1440×1000 and390×844,
light/dark. T3 collaborative preview used the newly started Factory origin and
current shell; no CSS/HTML injection or proxy. Both pages at360px measured
scrollWidth360 with no decision-panel elements beyond the right edge. Enter
closed and reopened plan Details. Captions identify the actual editable fork.
Unchanged canvas/component/native evidence is reused from the original packet.

**DEFERRED:** CI queries/triggers/watch/retries, full suites and manual broad
build/type/lint/audit/native cycles; consolidated cleanup remains after148.
Normal repository hooks may run build/types and their actual result is recorded
in the handoff. No dependency change. No production/active-run edit, remote tracker,
paid/native inference, deployment, release, status or merge effect. Mocks prove
prepared configuration/correction flow at provider hooks, not native enforcement
or native/session/process-crash recovery. Parent owns new independent acceptance.
