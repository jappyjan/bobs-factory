# Factory node guarantees: reuse, freshness, bound responses and convergence

**Date:** 2026-10-26
**Tested implementation:** `c85a2566` (B1 / Taskbot #158, epic #156).
**Mode:** scripted agent/script hooks, real isolated Git, production Factory runtime
and authenticated Factory API. No native agents, model inference, CI/provider
requests, production tickets or credentials.

## Scenario and assertions

A manually launched recipe revisits an unchanged agent result, watches its value
with Converge, binds a response to it, then checks that response's freshness.
The recipe runs against a disposable Git repository inside its own Factory home.

The maintained drive is `packages/edge-worker/test/NodeGuaranteesF1.test.ts`:

```sh
pnpm --filter ./packages/edge-worker exec vitest run test/NodeGuaranteesF1.test.ts
```

Passed assertions:

- Authenticated `POST /api/runs` accepts the recipe (202), and authenticated
  `GET /api/runs/:id` returns the run (200).
- The production runtime completes both visits with one physical scripted agent
  call and two immutable output receipts. Its activity includes exactly one
  `reused (inputs unchanged)` event.
- Converge returns `{stalled: true, cycles: 2, changed: false}` on the second
  identical observation; the recipe's route controls the loop.
- The Check node evaluates `{fresh: "response"}` to true after the bound response.
- Shutdown and cold reload retain the bound receipt digests; the response remains
  fresh while Git and its inputs are unchanged.
- A new real Git commit invalidates that response after restart.
- The drive closes its API server and both runtimes and removes its own home.

## Related regression evidence

The post-rebase focused command ran 37 passing tests across NodeGuarantees,
NodeGuaranteesF1, NodeRegistry and RulesBudget. It covers ordinary/parallel/foreach
reuse, changed inputs/items/revisions, dirty workspaces, Call aliases, stale
inherited evidence, accepted bindings before interruption, immutable/restarted
receipts, converge reset/stall behavior, registry/builder settings and bounded
rule evaluation. The edge-worker type check and repository pre-commit build/type
checks also passed. The broader run additionally passed all 139 existing
WorkflowRuntime tests. A targeted scalar-result check distinguishes a retained
null result from a removed output slot.

This validates scripted orchestration, persistence, rules, API visibility and Git
revision comparison. It does not establish live model, provider or human-interface
behavior; sibling node implementations use the documented revision/binding APIs.
