# Test drive: Storage retention (Taskbot 134)

**Date:** 2026-10-20  
**Goal:** Reclaim verified disposable update data and delivered worktrees while preserving resumable work and recovery state.  
**Mode:** Deterministic simulated agents and controlled update/provider adapters. No live provider inference or production worker replacement.  
**Tested base:** `cfc307cb8f701bfb7946b4122d06680bc7cb1037` plus the uncommitted implementation.  
**Final changed-code fingerprint:** `463527fc7267543684428b934cb1cefb0d5e8753c5ef406ae005eb1d3719eae5` over 46 sorted changed TS/TSX/JSON/MJS paths, each followed by NUL, file bytes, and NUL. This report is excluded.  
**Fixture roots:** Fresh temporary `f1-storage-134-*`, `f1-delivered-storage-*`, and `f1-storage-updates-*` homes and local Git repositories with bare remotes. They are removed after each scenario.

## Changed behavior and executed assertions

F1 applies because this changes issue termination, saved workspace ownership, Resume admission and startup reconciliation.

- The real embedded EdgeWorker receives `createIssue`, `startSession`, `viewSession` and `terminateIssue` through CLI RPC with `f1AgentHandlers("mock")`. A response appears, ownership is recorded, and the terminal event preserves unique workspace bytes and the native mock session ID. After worker restart, the ID remains available and a simulated runner continues with that same ID.
- A controlled completed WorkflowRuntime run has explicit simulated approval and exact delivery proof from a local bare remote. Startup reconciliation at an advanced clock removes its clean custom-root worktree. A stopped run's workspace remains. Saved outputs and the approval record still load from the real chunk-backed snapshot store after removal. This does not claim a real human approval or forge merge.
- Five UpdateManager stage/install/reconcile cycles use controlled lifecycle adapters and a newly constructed manager after each cycle. Actual retention-aware state copies, ownership records, integrity manifests, reconciliation and selected cleanup execute. Each successful cycle preserves all original config, run/gate, evidence, retained-chunk, auth and native-store sentinel bytes. The simulated worker count never exceeds one.

## Measured five-cycle result

| Cycle | Retained snapshot apparent bytes | Retained preparation apparent bytes |
| --- | --- | --- |
| 1 | 143 B | 120 B |
| 2 | 286 B | 240 B |
| 3 | 286 B | 360 B |
| 4 | 286 B | 480 B |
| 5 | 286 B | 600 B |

Two snapshots remain after cycle five. Preparation copies remain within their seven-day window; each copy is the same 120 bytes. These small fixture measurements establish constant copy size and bounded snapshot count, not production throughput or guaranteed reclaimed disk space. Apparent bytes are file lengths; filesystem free-space change is reported separately.

## Verification

Commands ran in a child environment with inherited `BOBS_FACTORY_*` settings removed, `F1_AGENT_MODE=mock` and `OPENCODE_LIVE=0`. This avoids using the active Factory's credentials and port settings.

- `pnpm build`: passed, including the web bundle and CLI/F1 builds.
- `pnpm typecheck`: passed across the monorepo.
- `pnpm biome ci .`: passed; 25 warnings refer to unchanged files. Changed-file checks pass without warnings.
- `pnpm -r --no-bail test:run`: passed. 3,787 Vitest tests and 41 desktop tests passed; three tests were skipped. Edge worker: 2,234 passed and one skipped. CLI: 233 passed. F1: 12 passed.
- `node --test scripts/tests/*.test.mjs`: 175 passed.
- `pnpm --filter bobs-factory-f1 exec vitest run test/storage-retention.test.ts`: all three scenarios passed. A final rerun emitted the measured table after a test-output-only change.
- Focused cases cover stale policies/previews, protected requests, historical producer proof, changed content, symlink/identity restrictions, damaged rollback-index rebuilding, shared group reservations, dirty and ignored files, local commits, failing teardown, protected group members, partial artifact deletion and replacement identities.

The built CLI also ran against a private temporary FactoryServer: status, revision-guarded policy save, preview, exact selected cleanup and historical preview passed. Reducing the fixture's snapshot count to one removed one eligible snapshot while retaining the mandatory rollback. This instance was stopped after verification.

## Headless browser evidence

The real built web bundle was served by an isolated FactoryServer. Headless `agent-browser` session `storage-134-1ed1973d` exercised policy save/reload, refresh preview and historical scanning. Desktop and 390-pixel mobile screenshots were captured and visually inspected. The session and fixture servers were closed afterward.

Evidence directory: `/Users/jappy/.bobs-factory/factory/evidence/manual-9a020f41-9844-4a38-b17b-977a1ed1973d`

- `storage-settings-134.png`: desktop settings, protected rollback reasons, warning and cleanup outcome.
- `storage-settings-mobile-134.png`: mobile layout with wrapping paths and readable controls.
- `storage-cli-smoke-134.json`: built CLI results.
- `storage-cycles-134.json`: measured cycle values.
- `storage-f1-134.log`: final executed F1 result.
- `storage-validation-134.json`: bounded command and source summary.

The screenshots use deliberately small update fixtures and a high warning threshold to make the warning visible. They show the real Storage UI, not a static mockup. The web build ID is `3229cce4755062a5c37a0f23`.

## Limits

Native provider inference and real native continuation were not exercised. Directory-independent native continuation has not been assumed: uncertain references retain their workspace. The tests use local simulated delivery evidence and never approve or merge a real delivery. Native Electron/platform behavior on other operating systems remains unverified; one desktop test skips an unavailable materialized Electron binary. No large production-data performance benchmark was run.

Unclassified historical data, uncertain native/review references, consumed desktop staging with changed contents and unreconciled recovery remain retained. Partial workspace groups require independently established remaining mappings. Interrupted teardown never retries automatically without explicit verified idempotency. These conservative cases are described in `docs/factory/storage-retention.md`.

## Integration with recovery changes from main

On 2026-10-20, integrated target `28d748d44852e6c304453defa34f16019eb38eee`
into task head `09a40cdeb3a4fba2101134d739ba1c97a29c39ca` for PR #164.
The automatic merge had no conflicts. Combined tree before this evidence and
changelog-link update: `d1ba0558894f1209ab6be719009a9e755016e010`.
No additional runtime source edits were needed.

Validation ran with inherited `BOBS_FACTORY_*` settings removed,
`F1_AGENT_MODE=mock` and `OPENCODE_LIVE=0`:

- `pnpm build` and `pnpm typecheck`: passed.
- EdgeWorker WorktreeRecovery, merge-recovery, capture-recovery,
  WorkflowRuntime, WorktreeArtifacts and StorageRetention suites: 219 passed.
- `pnpm --filter bobs-factory-f1 exec vitest run test/storage-retention.test.ts`:
  all three scenarios passed. Native mock continuation and terminal-event bytes
  survived restart; aged delivered work was reclaimed while stopped work and
  durable approval/output records survived. Five update cycles reproduced the
  table above, with at most one simulated worker.
- `F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/stuck-run-recovery.mjs`:
  all ten grouped assertions passed, including exact committed-worktree
  restoration, already-merged approved delivery reconciliation without provider
  mutation, and independently required correction after green CI. Synthetic
  evidence remains at
  `/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-stuck-recovery-A5aOjw/evidence.json`.
- CLI local startup and OwnedUpdateLifecycle suites: 13 passed.
- Desktop suite and repository Biome CI checks: passed.

This establishes simulated orchestration on the combined source tree. It does
not add real-provider continuation or other-platform native evidence; the limits
above remain. Fresh independent review and downstream QA remain required.
