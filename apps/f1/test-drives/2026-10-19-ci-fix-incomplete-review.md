# CI correction with an unfinished specialist review

Date: 2026-10-19. Tested `e53ef4fd` plus the working-tree fix. Agents and GitHub
responses were deterministic mocks; native Git, EdgeWorker, workflow persistence,
dashboard Retry and F1 issue-tracker RPCs were real and isolated.

## Failure and applicability

Run `manual-05131462-c641-4a6d-b5ba-859819a6f741` failed at `pipeline/ci-fix`
before invoking its agent. Its latest specialist round had no aggregate, and the
correction preflight used the same strict lookup as approval. Repeated Retry
requests therefore failed with `Latest configured specialist round has no
complete aggregate; approval is blocked` instead of repairing a merge conflict.

F1 applies because this changes saved-run recovery and correction routing.
The two focused regressions failed with that exact error before the fix. The
fix permits missing current aggregates only in correction readiness and the
post-correction review decision. Approval consumers retain the strict default;
older specialist or legacy receipts cannot complete the unfinished round.

## Drive

```sh
pnpm install --frozen-lockfile
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/ci-fix-incomplete-review.mjs
```

The driver uses a fresh unrelated repository and home, issue-tracker RPC port
3600 and dashboard port 3541. It creates a ticket, runs a structured inventory
and coverage review, and retains a genuine completed review as fixture evidence.
It then seeds two failed recovery cases: a missing aggregate and an approved
aggregate superseded by an unfinished round. After flushing state, stopping and
reconstructing the worker, it retries both through the supported dashboard API.

Both cases passed:

- The correction preflight ran and invoked the mocked fixer once.
- The post-fix decision required review; inventory extraction and the configured
  coverage specialist ran again before a new aggregate completed.
- The missing case reached review round 2; the superseded case reached round 3.
- Original completed evidence remained identical after persistence and recovery.
- Both runs reached their later assistance checkpoint with zero human approvals.
- F1 activities contained routing progress and the explicit question checkpoint.
- Shutdown released both isolated listeners.

Evidence: `/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-ci-review-UTBFeh/receipt.json`.
Log: `/tmp/f1-ci-fix-incomplete-review.log`. This establishes orchestration and
recovery behavior; it does not establish live model behavior or a real forge merge.

## Other verification

151 tests passed across `SpecialistReview`, `DeliveryCoordination`,
`MergeReadiness` and `FactoryPipeline`. The regression cases also confirm that
resolved provider failures can skip an obsolete fixer while fresh review remains
required, and that human approval still rejects the unfinished round.
Edge-worker type checking, build, changed-file Biome and `git diff --check` passed.

A local development binary was staged at
`/tmp/bobs-factory-ci-review-fix-20261019/bobs-factory-1.0.0-beta-darwin-arm64/`.
It records `dirty: true` and is not a published release. The canonical
`scripts/smoke-binary.sh` passed startup, assets, protected API checks, runtime
identity, MCP, shutdown and restart using an isolated home and ports 4397/4398.
Log: `/tmp/bobs-factory-ci-review-fix-smoke.log`. The existing worker and failed
run were not changed; deploying the patch requires the configured human approval.
