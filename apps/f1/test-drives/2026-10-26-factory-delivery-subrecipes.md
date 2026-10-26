# Factory nodes: CI, merge and external delivery sub-recipes

**Date:** 2026-10-26
**Tested implementation:** `4d0483b0`, based on `7ca69084`;
[PR #211](https://github.com/jappyjan/bobs-factory/pull/211).
**Ticket:** Taskbot #167, epic #156.
**Mode:** scripted agents/provider over real disposable Git repositories, linked
worktrees, local bare remotes and file-ticket persistence. Production Factory
runtime and authenticated API route fixture; no model calls, production tracker
writes, real hosted merges or browser-rendering claims.

## Maintained drive

The scenario named `scripted F1 external delivery drives correction, cold restart
and explicit completion through the authenticated API` lives in
`packages/edge-worker/test/FactoryDeliveryRecipes.test.ts`:

```sh
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryDeliveryRecipes.test.ts -t 'scripted F1'
```

The fixture copies the bundled graph under an isolated test ID (bundled recipes
are read-only) and drives the real Display/Check/Transform/Ticket nodes. Scripted
agents apply and correct a disposable file ticket, return observed ticket state
for verification and write the guide. The simulated provider/agents establish
orchestration and persistence, not live judgment or external integration quality.

Assertions:

- Authenticated `POST /api/runs` returns 202 and the external graph reaches its
  generic Accept/Request changes Display.
- `POST /api/runs/:id/view-answer` requests a correction. The applied changes
  remain; the correction changes the ticket and independent verification runs
  again. A new decision digest binds the new verification/guide.
- A cold runtime restart retains the pending second Display, its binding and the
  already-applied work. The Apply agent has still run exactly once.
- The second API answer explicitly accepts; final target observation and an exact
  originating-ticket comparison pass before the explicit Ticket completion node.
- The run emits `{applied:true, verified:true, ticketUrl}`; the real persisted
  disposable ticket has completed status. The activity API returns the Display
  activity and both decision records remain retained.
- Servers, runtimes, capacity services and disposable homes are cleaned up.

The same suite separately exercises the bundled CI and Merge graphs with real
local Git and scripted provider responses: green CI; fixes with/without code
changes; infrastructure rerun; matching-head wait across restart with zero held
capacity; stale/raw/unsafe carried approval rejection; safe carry; provider merge
queue; lost merge response; restart after merge before ticket completion;
external correction/scope handback/drift; deferred delivery; and a mixed path
whose final acceptance binds repository approval/confirmed merge together with
external verification. Repository-only completion and mixed deferral of ticket
completion are asserted separately.

Related generic regressions exercise per-repository diff baselines, missing and
option-like baselines, and pending CI/PR summaries. Existing Factory IO tests
cover grouped merge queues, shared reservation release and uncertain effects.

## Limits

This is a runtime/API drive, not a full EdgeWorker startup, browser, native agent
or live GitHub/GitLab/tracker drive. D1 owns the final stock Factory/Takeover
composition and consolidated integration validation. Legacy compositions remain
active in this PR. The engine post-effect revision follow-up must be included
before composing approvals after mutating publication nodes; these tests also
retain the upstream guarantees/F1 regression suite.

## Verification results

After rebasing onto current `origin/main`, all **156 tests in seven files** pass:

```sh
pnpm --filter ./packages/edge-worker exec vitest run \
  test/FactoryDeliveryRecipes.test.ts test/FactoryIONodes.test.ts \
  test/RepositoryIONodes.test.ts test/FactoryRecipeGraph.test.ts \
  test/FactoryLogicFlow.test.ts test/NodeGuarantees.test.ts \
  test/NodeGuaranteesF1.test.ts --maxWorkers=2
pnpm --filter ./packages/edge-worker typecheck
```

The initial `pnpm install && pnpm build`, changed-file Biome and `git diff --check`
pass. The normal pre-commit hook passes its workspace build/typecheck and Biome
gates. Its temporary lint-staged backup is cleaned up; existing unrelated stashes
remain untouched. The engine follow-up #207 remains unmerged at this validation
point and is explicitly listed as a dependency in the PR.

## C4 review-fix validation

The maintained scripted scenario `scripted F1 merge exposes required review and
retains approval across capacity-free wait and restart` adds coverage for a green
PR blocked by `REVIEW_REQUIRED` and `BLOCKED`. The authenticated run API exposes
the actual provider blocker in the pending Display. Continuing through the API
enters a PR-read Wait with zero active/queued capacity. A cold restart retains
that wait and the original approval; clearing the provider requirement confirms
exactly one merge, with no `to-ci` outcome or repeated approval.

Focused runtime scenarios also cover pending checks, provider wait blockers,
queue-managed `BEHIND`, timeout assistance, and green CI with `BEHIND`/`DIRTY` fix
blockers. The fixer fetches and rebases onto an advanced real disposable base,
then the separate push node publishes the new head and the recipe returns to
review. During an ordinary CI wait, base-only movement completes without another
review; a provider head change still returns to review. Providers and agents
remain controlled; the local Git repositories, runtime, persistence and API are
real. Run the full focused command above to include these regressions.
