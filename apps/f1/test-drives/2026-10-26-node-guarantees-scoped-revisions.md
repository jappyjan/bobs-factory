# Factory node guarantees: scoped revision reuse

**Date:** 2026-10-26
**Tested base:** `ce1f6e9e26cc58e91de3608e991fb6776db9613d` plus the B1 review-fix working tree in this PR.
**Mode:** scripted agent/script hooks, real isolated Git, production Factory runtime
and authenticated Factory API. No native agents, model inference or provider calls.

## Scenario and assertions

The maintained drive is `packages/edge-worker/test/NodeGuaranteesF1.test.ts`:

```sh
pnpm --filter bobs-factory-edge-worker test:run test/NodeGuaranteesF1.test.ts
```

The authenticated API launches an agent scoped to `value`. A scripted change node
commits an unrelated file after its first visit, then changes `value` after its
second visit. Converge watches the stable output and exits after three visits.
A response binds the agent receipt and a Check evaluates its freshness.

Passed assertions:

- Authenticated `POST /api/runs` returns 202 and `GET /api/runs/:id` returns 200.
- Three agent visits produce two physical scripted executions: the unrelated
  commit permits reuse, while the commit to `value` triggers execution.
- The runtime logs exactly one `reused (inputs unchanged)` event.
- Converge reaches `{stalled: true, cycles: 3, changed: false}`; the Check passes.
- Bound receipt digests and scoped freshness survive shutdown/cold reload.
- Another unrelated commit after restart keeps the bound response fresh;
  committing a change to `value` makes it stale.
- The drive closes the server/runtimes and removes its temporary repository.

## Related regression evidence

The nine-suite run passed 224 tests across NodeGuarantees, NodeGuaranteesF1,
NodeRegistry, RulesBudget, RevisionBinding, RevisionBinding.input-history,
ForeachRuntime, WorkflowRuntime and WorkflowExecution. A final focused pass of
NodeGuarantees, NodeGuaranteesF1 and NodeRegistry passed all 36 tests after adding
coverage for multiple inherited reviewer scopes and Snapshot readers and finishing
reuse validation. Edge-worker typecheck passed after the implementation changes.

The regression tests exercise static and dynamic path scopes in Parallel and For
each, commits inside/outside a scope, dirty/untracked files, inputs-only scope,
restart, multiple inherited scopes, scoped Snapshot reads, unborn HEAD and failed
observations, shared observations across fresh references/reuse, and validation
rejecting reuse on previous-receipt-dependent nodes.

This validates scripted orchestration, persistence, rules, API visibility and
local Git comparison. Remote expected-head enforcement remains the merge
provider's responsibility, as documented in `docs/factory/nodes.md`.
