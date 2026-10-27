# Update copy failures and snapshot retention (Taskbot 172)

Date: 2026-10-27. Tested base: `0aa5748bc97c118ea4a43bfb112a83cae47a51d3` plus this implementation.
SHA-256 over the five sorted paths below, each followed by NUL, bytes and NUL:
`1b684fee148b37e875d7e1fda376f18274d30a23346d1026624426e9cd71e0f1`.

- `apps/cli/src/services/UpdateStateSnapshot.ts`
- `packages/edge-worker/src/updates/UpdateManager.ts`
- `packages/edge-worker/src/storage/HistoricalStorage.ts`
- `packages/edge-worker/src/storage/StorageRetention.ts`
- `apps/f1/test/storage-retention.test.ts`

F1 applies to the existing update/retention workflow. The drive uses the actual
UpdateManager, retention-aware copy, UpdateArtifacts and automatic StorageRetention
coordinator, with scripted candidate and lifecycle adapters. No live provider,
production instance, native service restart or large fixture is involved.

Reproduce:

```sh
pnpm --filter ./apps/f1 exec vitest run test/storage-retention.test.ts -t 'keeps update retention bounded'
```

Assertions:

- Five stage/preflight/install/restart cycles complete successfully. The coordinator
  runs during each update and receives the completion notification after the operation
  lock is released. Earlier completed owned snapshots become disposable and are
  removed with completed deletion receipts, including private quarantine cleanup.
- One snapshot remains after every cycle: 188 apparent bytes each time. Preparation
  grows by 120 bytes per cycle within its retention window. These are fixture sizes,
  not a throughput benchmark or a claim about physical disk savings.
- A dangling corepack-style job-home link is omitted from each candidate preflight,
  kept verbatim in each snapshot and restored by the injected health-failure rollback.
- The preceding successful rollback stays referenced while the next transaction
  preflights. Config, run/gate, evidence, chunk, auth and native-store sentinels survive
  all five updates and the sixth update's rollback.
- Update and cleanup ownership exclude each other. Maximum simulated workers: one.

Focused regressions separately cover both copy implementations, external/dangling
links, job-home sockets/FIFOs, refusal outside those homes, integrity verification,
insufficient-space refusal before copying, live-supervisor cancellation/lock release
when ENOSPC also refuses journal and guard writes, historical enrollment and cleanup,
and protection of latest/in-flight snapshots. Native OS lifecycle behavior remains
covered by the existing release lanes; it is not claimed by this scripted drive.
