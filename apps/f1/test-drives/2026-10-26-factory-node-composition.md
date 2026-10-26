# Factory and Takeover node composition (D1a)

**Date:** 2026-10-26
**Implementation:** `349324e663fb840d9f382fc8262c19bc5d814e75`, based on
`a1723392` (`origin/main`). Taskbot #169, epic #156.
[PR #213](https://github.com/jappyjan/bobs-factory/pull/213).
**Mode:** scripted agents and provider replies over real disposable Git repositories,
linked worktrees, local bare remotes, persisted file tickets and the authenticated
Factory API fixture. No live model calls, hosted merges or production tracker writes.

## Maintained runtime/API drive

```sh
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryV2Composition.test.ts test/V2ReviewRecipe.test.ts --maxWorkers=2
```

The drive uses the actual bundled Factory and Takeover definitions and executes
their generic nodes. Legacy tools and scripts throw if invoked. The consolidated review/composition run
passed 33 cases; its empty-work assertion raced with Display dispatch. The fixture
now waits for the durable waiting state and decision, also asserts that no Git push
occurred, and passes on a focused rerun. No production behavior changed after that
consolidated run:

```sh
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryV2Composition.test.ts -t 'empty implementation' --maxWorkers=1
```

All 34 review/composition cases have therefore been verified. The authenticated
run API returns 202; Display answers use the public `view-answer` endpoint and
activity pages contain timestamped workflow events.

Assertions cover:

- Repository delivery: clarify/plan, routine check-in, real commit with hooks
  disabled, push, draft PR ensure, all six specialists, CI, skipped nonvisual QA,
  fresh human approval, provider-confirmed merge and exactly one ticket completion.
- External delivery: apply/independently verify a disposable ticket, explicit human
  acceptance and final observation before completion, with no repository merge.
- Mixed delivery: repository merge receives `completion.final:false`; a cold
  restart retains the pending node-engine approval. External delivery sees the
  actual approval and confirmed merge receipts, and only its final acceptance
  completes the ticket. Provider merge and ticket completion occur once.
- Deferred delivery explains the restriction and keeps the ticket open.
- Takeover reads the host-prepared existing request and ticket, skips clarify/plan,
  continues the same request and follows the ordinary delivery gates.
- Architecture revision returns through the parent planning route. Human changes
  repeat review, CI and QA before renewed approval. A mid-merge head change returns
  to review, then safe cumulative impact carries the original explicit approval
  to the latest published head and selects the actual carried producer for merge.
- An empty implementation reaches assistance before push/PR ensure. Four rejected
  correction rounds reach human assistance even when every round changes HEAD;
  a needs-input fixer without a Display fails before publication.
- Every nonterminal legacy run state stops on load with the restart reason.
  Terminal history remains unchanged, old runs cannot resume/retry, and saved
  legacy forks are disabled while a new complete Factory fork remains available.
- The existing canvas layout expands/collapses real child calls without any new
  recipe-specific rendering.

The integrated correction drive also protects freshness across repeated calls:
Call envelopes do not retain pre-effect checkout stamps, historical ledger claims
remain data, and the final accepted review stamps the current repository content.
Independent reviewer freshness checks remain required.

## Supporting verification

Focused planning, QA/approval, delivery and Improve suites pass; review/composition
were rerun after the integrated freshness fixes. Additional passing commands:

```sh
pnpm --filter ./packages/edge-worker exec vitest run \
  test/RepositoryIONodes.test.ts test/FactoryIONodes.test.ts --maxWorkers=2
pnpm --filter ./packages/edge-worker exec vitest run \
  test/WorkflowCatalog.test.ts test/NodeGuaranteesF1.test.ts \
  test/TakeoverIntakeRecipe.test.ts test/SimpleRecipe.test.ts --maxWorkers=2
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryComposition.test.ts --maxWorkers=1
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryDeliveryRecipes.test.ts -t 'head change during merge' --maxWorkers=1
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryRecipeGraph.test.ts --maxWorkers=1
pnpm --filter ./packages/edge-worker build
pnpm --filter ./packages/edge-worker typecheck
```

The merge race regression covers preflight and post-submission queue confirmation;
no changed-head result completes a ticket. Uncertain effect identity remains
retained rather than being treated as confirmed absence. Source resolution tests
cover ticket identifiers/URL aliases, prepared requests and explicit Call ports.
Simple keeps its direct native conversation path, and Improve's existing mocked
end-to-end suite continues to pass. The bounded catalog supports multiple complete
private forks. Changed-file Biome and `git diff --check` pass. The normal pre-commit
hook passes workspace build/typecheck and lint-staged.

## Limits and cleanup

This is a production-runtime/API drive with scripted agents/providers, not a live
integration, full EdgeWorker startup or browser screenshot drive. It establishes
composition, durable state, authority binding and activity/API behavior; it does
not establish live model judgment or hosted-provider compatibility beyond the
existing adapter tests. Runtimes, API servers, capacity services and disposable
homes are cleaned up by the fixtures. Historical F1 evidence is preserved.

D1b remains responsible for deleting the legacy engine, domain tools/checks and
legacy web presentation. D1a gates legacy execution without migrating frozen
workflows, forks, receipts or native conversations.

## PR #213 fix round (2026-10-27)

Tested the fix-round working tree based on `1b25bc3f`; the fixes and this addendum
are committed together. The same scripted authenticated runtime/API drive covers
post-merge external replanning with both explicit and carried approvals. A revised
external-only plan retains the original repository plan and actual approval/merge
receipts; implementation and merge each run exactly once. Stop ends the workflow
without completing the ticket. No live model calls or hosted mutations are used.

Passing focused checks:

```sh
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryV2Composition.test.ts -t 'post-merge' --maxWorkers=1
pnpm --filter ./packages/edge-worker exec vitest run \
  test/SimpleRecipe.test.ts --maxWorkers=1
pnpm --filter ./packages/edge-worker typecheck
```

The three post-merge scenarios and five Simple tests pass. Simple coverage includes
reloading and continuing completed, running and waiting unmarked graphless runs,
and rejecting unavailable continuation before changing in-memory or persisted
state. The frozen unmarked definition is preserved. Existing old-graph gating
coverage remains in the composition suite.
