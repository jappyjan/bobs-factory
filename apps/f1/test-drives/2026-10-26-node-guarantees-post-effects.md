# Factory node guarantees: post-effect revisions

**Date:** 2026-10-26
**Tested implementation:** `c7fad76b` over `7ca69084`
(Taskbot #158 follow-up, epic #156).
**Mode:** real disposable Git source clone, linked worktree and local bare remote;
scripted PR provider; production Factory runtime, Display and authenticated API
route fixture. No model calls, external provider mutations or production state.

## Scenario and assertions

The maintained drive is the final scenario in
`packages/edge-worker/test/NodeGuaranteesF1.test.ts`:

```sh
pnpm --filter ./packages/edge-worker exec vitest run test/NodeGuaranteesF1.test.ts
```

An inputs-only Transform supplies commit/PR metadata. The recipe commits a dirty
worktree, pushes the commit, ensures a draft PR, and waits at a Display bound to
all three receipts. The test submits its answer through the authenticated
`POST /api/runs/:id/view-answer` route, then evaluates `fresh("approval")` in Check.

Assertions:

- Git commit changes HEAD, and the local bare remote contains the pushed HEAD.
- Commit, Push and PR ensure receipts stamp the resulting HEAD and clean workspace.
- The provider receives exactly one PR creation; the Display answer returns 200.
- The runtime completes with `{passed: true, current: true}` at the freshness gate.
- A cold restart retains fresh Commit, Push, PR and bound Display receipts.
- Another real commit invalidates all four receipts. Inputs-only metadata stays
  independent of repository changes.
- The drive stops its server/runtimes and removes only its own temporary home.

The original implementation fails this scenario because the Commit stamp retains
its pre-effect HEAD and dirty workspace. The added generic effect tests also fail
for repository and path scopes on the original implementation. A cold retry
regression independently fails because backoff creates an empty-read stamp.

Related focused coverage includes explicit bindings that must stay stale across
an effect, already-stale inherited evidence, repository/path/none scopes and a
cold retry with no accepted stamp. Existing approval tests preserve observations
frozen before a human wait, even when producers use a narrower scope.

This proves local revision comparison, orchestration, persistence and API answer
handling with controlled providers. It does not exercise live PR hosting, remote
races, native model behavior or browser rendering. Freshness still compares the
local checkout; provider expected-head checks remain necessary for merge gates.

## Verification results

The final requested focused run passed all **183 tests in eight files**:

```sh
pnpm --filter ./packages/edge-worker exec vitest run \
  test/NodeGuarantees.test.ts test/NodeGuaranteesF1.test.ts \
  test/NodeRegistry.test.ts test/RepositoryIONodes.test.ts \
  test/RepositoryTicketIO.test.ts test/DisplayNode.test.ts \
  test/FactoryLogicFlow.test.ts test/AgentNode.test.ts --maxWorkers=2
pnpm --filter ./packages/edge-worker typecheck
```

The edge-worker typecheck, changed-file Biome checks and initial workspace build
also passed. The normal pre-commit hook passed its Biome, workspace build and
workspace typecheck gates. The focused run includes the maintained scripted drive
above. [PR #207](https://github.com/jappyjan/bobs-factory/pull/207) retains the
implementation and this evidence.
