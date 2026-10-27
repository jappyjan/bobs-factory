# Node-engine cutover: consolidated integration validation (D2a)

**Date:** 2026-10-27  
**Source:** integrated main `52047eb60e1d249ea15e18272a4e974af5d2fae7`, plus the
fixture/validation fixes committed with this report. Taskbot #170, epic #156.  
**Mode:** mocked/scripted agents and providers; real disposable Git repositories,
worktrees, loopback HTTP, persisted runtime state and controlled helper processes.
No inference, hosted merges, production tracker writes or physical desktop claims.

## Applicability and assessment

F1 is required for the complete payload since the prior published nightly
(`5d5f2760`): the new engine changes recipe execution, human Display decisions,
IO effects, recovery and old-run availability. The maintained node suites exercise
Factory repository, external, mixed and deferred delivery; Takeover; Improve;
Simple; architecture revision/check-in; approval carry; review stalls; freshness;
and restart-safe effects. Historical reports and old engine fixtures retain their
original identities; the nightly no longer executes deleted engine imports.

## Reproductions and corrections

- The operator MCP recovery fixture lacked `engineVersion: "nodes-v1"` and was
  correctly refused as an unavailable old recipe. Its current-node fixture now
  passes the real compiled stdio MCP recovery path (99 package tests passed).
- Active release fixtures still used agent-embedded questions, script nodes,
  removed question operator tools and deleted `FactoryTools` imports. Ported human
  gates use Display and `view-answer`; commands use Exec's structured JSON output.
- Storage fixtures constructed a legacy stock checkpoint and old merge-tool
  receipts. Controlled current-node recipes now execute the actual Merge node and
  retain its stamped receipt. Stock Factory/Takeover composition is independently
  covered by the maintained composition suite. Terminal receipt discovery ignores
  temporary atomic-write files. Seven storage cases passed together; the final
  ticket-assignment case passed after enabling that explicit fixture trigger.
- The intentional 100 ms merge-wait timeout also expired during recovery before a
  fresh provider read. The first timeout is retained; recovery gets 10 seconds.
- Concurrent full and focused runs oversubscribed the local host and exhausted
  real-time deadlines in Improve/review/QA. Duplicate drives were terminated and
  the edge-worker suite now caps file-level concurrency at two. No assertions or
  product deadlines are removed. The full package command is rerun after these
  fixes; CI remains required before merge.
- The first complete Linux CI run passed 215 edge-worker files but failed two
  Exec files because `bwrap` was absent (`spawn bwrap ENOENT`). Shared workspace
  setup now installs Bubblewrap and probes the actual namespace/bind invocation
  before testing. Sandbox enforcement and its assertions remain enabled. The
  nightly drive budget is 30 minutes to accommodate observed Linux disk timings.
- The early Linux probe then exposed Ubuntu's user-namespace mediation:
  `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. Setup now loads
  the distribution's optional `bwrap-userns-restrict` AppArmor profile only if
  the sandbox probe fails, then requires the probe to pass. Global user-namespace
  restrictions remain enabled; the packaged profile strips capabilities from
  the executed command. See the [upstream profile](https://gitlab.com/apparmor/apparmor/-/blob/master/profiles/apparmor/profiles/extras/bwrap-userns-restrict).

## Completed maintained scripted drives

Run after the workspace build (desktop tests generate their update-service bundle):

```sh
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/desktop-service-lifecycle.mjs
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/update-maintenance.mjs
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/localhost-noauth.ts
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/api-responsiveness.ts
node --test --test-concurrency=1 scripts/tests/*.test.mjs
pnpm --filter bobs-factory-desktop test:run
pnpm --filter bobs-factory-f1 exec vitest run test/storage-retention.test.ts --maxWorkers=1
pnpm --filter bobs-factory-f1 exec vitest run test/storage-retention.test.ts -t 'node-delivered ticket' --maxWorkers=1
```

Passing assertions/results:

- Desktop lifecycle: one-home ownership; disconnect retains the pending Display;
  cold restart and isolated preflight/snapshot retain its exact decision, outputs,
  native checkpoint and history; one answer completes once. A resumed node's new
  attempt ID is excluded from the durable-checkpoint comparison.
- Update maintenance: 11 assertions, including reboot fencing, deferred input
  release, actual operator/dashboard transport descendant ownership and in-flight
  read/Wait draining with zero agent slots. The synthetic native session ID and
  current Display remain preserved; completion runs once after release.
- Localhost/API-key lifecycle: 10 checks through IPv4/IPv6, project onboarding,
  real worktree/Exec execution, TLS remote login/logout/revocation, local SSE,
  origin rejection and authentication migration. External requests: none.
- API responsiveness: actual HTTP mutations and cold restart retain a bound
  Display and 57,603,120 logical history bytes. One full scoped context read and
  355 version probes run during resumed role preparation (observed maximum
  212 ms); retry retains saved evidence. Values describe this local run only.
- Release scripts: **181 passed**, including artifact/source/evidence integrity,
  publication recovery, stable protections and unsigned update/rollback checks.
- Desktop: **41 passed, 1 skipped**; Electron's physical ASAR helper test skips
  because its binary is not materialized. This is not native packaged acceptance.
- Storage: all eight cases verified across the suite and final focused trigger
  rerun. Controlled delivery proves cleanup from actual Merge receipts while
  retaining resumable work, copied evidence and native continuation.

## Current-node nightly gates

The release workflow now explicitly runs these maintained suites in addition to
its full workspace tests. Their logs retain the names expected by evidence intake:

- `TicketTracking`, `LinearActivitySink` → `linear-delivery.log`.
- `V2PlanningRecipes` → `architecture.log`.
- `FactoryV2Composition`, `FactoryDeliveryRecipes`, `TakeoverIntakeRecipe`,
  `ImproveRecipe`, `ImproveBoundaryComposition`, `SimpleRecipe` →
  `architecture-continuation.log`.
- `V2QaApproval`, `V2ReviewRecipe`, `NodeGuaranteesF1` →
  `impact-feedback-recovery.log`.

These tests exercise production runtime/API paths with scripted agents/provider
responses, not live model judgment. Normal candidate-bound native/desktop receipts,
source/evidence intake, exact main CI and publication gates remain required.

## Other checks and limits

`pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, focused Biome,
`actionlint` and `git diff --check` passed. Lint retains existing warnings.
The initial direct release/desktop test invocation ran before generated artifacts
existed and failed imports; the supported built/package invocations above passed.

`pnpm audit` reports the same **16 advisories (5 high, 6 moderate, 5 low)** already
owned by Taskbot #152: zod, body-parser, fastify, fast-uri, Electron and undici.
Dependency/license inputs are unchanged. Resolving that separate ticket requires
owning direct-dependency updates, zero audit advisories and reviewed source/baseline
updates (including Electron); this D2a change does not claim to resolve it.

Disposable runtime/server fixtures shut down their owned processes. Retained F1
homes/receipts stay under the system temporary directory. No production run reset,
worktree deletion, ticket reset or stable publication is part of D2a.
