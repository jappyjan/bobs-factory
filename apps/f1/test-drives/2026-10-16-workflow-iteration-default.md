# Workflow iteration default

**Date:** 2026-10-16
**Source:** `4c6ad3c48a49cde01a6751e08f6279d8a8ec2e48` plus this change to
`Workflow.ts`, historical stock fingerprints and the runtime cap regression.

## Scenario and assertions

Raise omitted `maxVisits` from 8 to 40 while preserving finite execution,
explicit limits, saved progress and previous stock recipe recognition.

The drive used a real CLI-platform EdgeWorker, the injected F1 issue tracker,
local Git worktrees and `f1AgentHandlers("mock", fixtureResponse)`. Each issue
selected a fixture workflow through `[workflow=...]`. Its single review agent
returned a deterministic approval decision and branched back while unapproved.
No provider CLI or inference API was invoked.

## Results

- **Old boundary:** an omitted-limit workflow completed on pass 10, with exactly
  10 runner calls and completed history records; no continuation was needed.
- **Default ceiling:** an always-unapproved workflow executed exactly 40 agent
  calls, then failed visibly before a 41st call. Its saved `iterationLimit` was
  `{step:"review",visits:41,limit:40}`.
- **Explicit limit:** `maxVisits:8` executed exactly eight calls, then stopped
  before a ninth. It retained all eight completed results.
- **Restart:** after stopping EdgeWorker, a fresh WorkflowRuntime loaded the
  eight-pass snapshot with its limit, counters, failure and history intact.
- **Activities:** F1 `viewSession` returned 12, 42 and 10 timeline activities for
  the three scenarios respectively.
- **Migration:** direct catalog checks recognized the previous stock,
  conservative and legacy review definitions without creating local forks;
  subsequent stock launches selected the new 40-pass default.
- EdgeWorker and the recovery runtime shut down cleanly.

## Commands and evidence

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-edge-worker test:run test/WorkflowRuntime.test.ts test/WorkflowCatalog.test.ts test/WorkflowMigrationIdentity.test.ts test/FactoryPipeline.test.ts
F1_AGENT_MODE=mock bun /tmp/bobs-factory-iterations.nwaAQn/drive.mjs
```

The focused suite passed 192 tests. The catalog and identity tests also passed
again after finalizing historical fingerprints (21 tests). Changed TypeScript
and JSON passed Biome, and `git diff --check` passed.

Local drive evidence: `/tmp/bobs-factory-iterations.nwaAQn/drive-r2.log` and
`/tmp/bobs-factory-iterations.nwaAQn/run-75KWGG/receipt.json`. The initial fixture's
30-second deadline was too short for 40 sequential mocked runner lifecycles;
the final drive used a bounded 150-second deadline per scenario and passed.

## Limits

This validates orchestration with mocked agents, not real model convergence or
provider costs. Existing production runs were inspected read-only. Frozen
production snapshots retain their accepted limits; the raised default applies
to new launches after installation.
