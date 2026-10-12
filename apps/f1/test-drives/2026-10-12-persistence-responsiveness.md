# F1: responsive history persistence

**Date:** 2026-10-12
**Tested source:** `a30cb62ff4a1ae218aeef6bbd81ebfdea72c3532` (implementation in `e26b65e8`)
**Mode:** mocked agents and a controlled script; no live inference or production service.
**Goal:** keep HTTP responsive while saving large histories, preserve conversations and human gates through restart, and load dashboard/activity payloads selectively.

This runtime/session/activity change requires F1 under the canonical applicability policy. The retained [fixture](assets/persistence-responsiveness.ts) uses the real CLI tracker, RPC server, EdgeWorker, workflow runtime and dashboard HTTP routes. It creates a fresh local repository and bare origin in a temporary home, uses ports 3680/3681, and removes the passing fixture after shutdown. Failed fixtures are retained for diagnosis.

## Commands

From the repository root:

```sh
pnpm build
pnpm typecheck
pnpm --filter bobs-factory-core test:run
pnpm --filter bobs-factory-edge-worker exec vitest run --maxWorkers=4
F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx ../../apps/f1/test-drives/assets/persistence-responsiveness.ts
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/bobs-responsive-native-accepted
./scripts/smoke-binary.sh /tmp/bobs-responsive-native-accepted/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
```

## Assertions and results

| Measurement | Result |
| --- | ---: |
| Logical transcript | 1,073,741,824 bytes |
| HTTP requests during saves | 546 |
| HTTP p99 | 3.688 ms |
| Maximum measured HTTP latency | 16.294 ms |
| Maximum event-loop delay across the entire drive | 620.233 ms |
| New payload bytes for the tail append (excluding manifests) | 2556 |
| Maximum state capture duration | 4.600 ms |

- Create a CLI issue over RPC, start its session, and observe a coherent visible response.
- Save 2,048 immutable 512 KiB transcript entries (1 GiB logical history) while polling the actual dashboard `/api/version` route with a one-second per-request timeout.
- Append a small tail and assert new payload writes stay below 2 MiB.
- Retain a 4 MiB run artifact and 48 large history receipts; launch a workflow that stops at a human question.
- Stop and restart the same home. Verify the native session identifier, tail and unanswered gate remain intact.
- Read the dashboard summary/artifact preview and an eight-entry activity page without requesting complete historical payloads.
- Supply one explicit answer through HTTP, verify the workflow completes, shut down and reload the saved transcript tail.

The machine-readable [receipt](assets/2026-10-12-persistence-responsiveness.json) contains the measured values and passed checks.

## Other verification

Core: **17 files / 244 tests passed**. Edge worker: **150 files / 1,952 tests passed**, with one existing skip. Repository build and type checks and staged-file Biome checks passed through the normal commit hooks.

The native darwin-arm64 smoke check validates two isolated starts, shell/assets and MCP, direct localhost API access without cookies, public-host authentication, origin denials, runtime identity and shutdown/restart. The binary build identifies source `a30cb62f`; its dirty flag records only pending changelog/evidence documentation, with no runtime-source changes. The receipt retains the executable hash and build metadata. This is an isolated development smoke check, not release validation, and does not install or upgrade the running Nix service.

## Limits and retrospective

Synthetic strings repeat and deduplicate. This checks logical-history scaling, ordering and responsiveness; it is not a benchmark of 1 GiB of unique disk writes or proof of live-provider behavior. New-payload bytes exclude manifest bytes. The event-loop monitor covers the entire drive, including fixture setup, synchronous Git operations and restart reads; HTTP timings cover requests during saves. Native packaging smoke and source-mode F1 are separate checks.

The async storage transition exposed real checkpoint/stop ordering and test cleanup assumptions. Cancellation is checked after awaited graph commits, native EventEmitter callbacks retain an observed checkpoint barrier, and fixtures await disk/notification readiness before asserting or removing homes. All final assertions remain in place.

Version 5 uses manifests plus chunk directories; back up/move the complete home and use a compatible backup for downgrade. Legacy files are retained. Atomic write/close/rename protects the last complete snapshot against process interruption; power-loss durability and automatic chunk garbage collection are outside this change.
