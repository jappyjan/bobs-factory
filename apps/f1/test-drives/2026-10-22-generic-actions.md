# Test Drive #139: generic Snapshot, File issues and Launch runs

**Date:** 2026-10-22. **Goal:** execute reusable side-effect blocks through the
real EdgeWorker/CLI workflow with deterministic providers and durable recovery.
**Test repository/home:** fresh disposable local bare origin/worktrees under
`/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-taskbot139-actions-3BLqVc`.

Part of [epic #135](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135).
No later epic ticket was started. The legacy Improve routine remains intact.

Production source, tests and drivers are frozen at
`ae847b3573157e0bfa6006ddbadbdb6f4d856481`, tree
`34495518ecf931ad4ed5a40157ff7898bb321477`, on base
`791b7405f78c654c07e58c0395a4802e6229bf0a`.
Node `24.21.0`, pnpm `10.33.1`; native bundle Bun `1.4.2`.
The final evidence commit changes only reports, receipts, screenshots and the
changelog PR link. A complete production/check input inventory and
[unchanged-input proof](assets/taskbot139-actions/unchanged-input-proof.json)
prove those inputs unchanged after the frozen-source checks. Raw evidence keeps
its original bytes; the local artifact-only Biome policy disables transformations
inside the receipt directory. Executable F1/UI drivers remain outside that
policy and under repository lint; repository lint/CI-lint passed again after
adding the evidence.

## Mocked EdgeWorker drive

**PASS**, 2026-10-22 `02:21:52.376Z–02:23:14.148Z`; owned worker shutdown
completed `02:23:14.238Z`. Source and driver commit `ae847b3573157e0bfa6006ddbadbdb6f4d856481`,
clean delta SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Driver `apps/f1/test-drives/assets/taskbot139-actions.mjs`, SHA-256
`f0efac4e8485c0b0374e9a099f4ae16edd5a5a9f2fd20b387a6bb9d21b124bff`. Executed core/MCP/EdgeWorker/F1 build hash
`1b1cb156ddcafb6827115d0996e89de4ef14ce479ab88f81df07b124df38442f`. **0 paid model calls**.

Reproduce after `pnpm build`:

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot139-actions.mjs
```

The driver uses the actual EdgeWorker, CLI intake/RPC, WorkflowRuntime,
MachineCapacity, disposable Git worktrees/local bare origin, native Linear
adapter with a deterministic mock client, and mock agent runner factory. Only
child forge responses are scripted at the provider hook. Real runtime human
review gates and exact original tool-owned provider receipts govern waves.

- Snapshot → read-only agent → File issues → Launch runs executes end to end.
- The actual scoped MCP stdio process registers the 200-call budget, reads the
  original pinned tracked blob despite mutable worktree changes, and rejects
  private paths and another repository ID.
- Six mock provider creations force backlog/null assignee/delegate/no template;
  a lost creation acknowledgement reconciles without another provider send.
- `wait:true` returns merged outcomes. `wait:false` advances the recipe, keeps
  immutable returned links, and dispatches wave two after exact approval/merge,
  including after a full worker reconstruction against the same isolated home.
- Each child retains its own worktree and generic parent identity. Parent Stop
  leaves existing children working while blocking the next wave; Resume uses
  the original queued identity. Batch stop cancels active/pending children.
- CLI activity content/timestamps and pagination are checked. The terminal
  outbox intent remains retained. This CLI fixture marks a mock ticket completed
  on role completion; late unmerged progress is explicitly superseded by the
  existing closed-ticket safeguard. No delivered confirmation is invented.

The tracker intake returned real controlled issue IDs and accessible metadata;
three sessions produced timestamped activities, with pagination and formatting
asserted through the actual CLI receiver. Server/session cleanup completed with
no unhandled errors. Only the expected programmatic-config watcher warning
appeared. The fixture supplied isolated programmatic configuration and controlled
provider clients.

The [receipt](assets/taskbot139-actions/f1-results.json) records IDs, revisions,
counts, waves and the exact terminal tracker disposition. This is orchestration
and adapter evidence with controlled providers, not live model quality, remote
forge behavior, native coding-agent execution or production issue filing.

## Final local gates

All commands passed on the final source with Node `24.21.0` / pnpm `10.33.1`:

| Check | Result |
| --- | --- |
| `pnpm build` / `pnpm typecheck` | PASS on clean `ae847b35`; logs retained |
| `pnpm lint` / `pnpm exec biome ci` | PASS; existing warnings retained |
| `pnpm test:packages:run --maxWorkers=2` | 327 files, 4,115 passed, 2 skipped |
| CLI complete suite, workers 2 | 22 files, 254 passed |
| F1 app complete suite, workers 2 | 2 files, 17 passed |
| Desktop complete suite | 41 passed, 1 skipped |
| `node --test scripts/tests/*.test.mjs` | 179 passed |
| F1 and UI driver `node --check` | PASS |
| `pnpm audit --json` | 0 advisories across all severities |

[Gate summary](assets/taskbot139-actions/gate-summary.json) retains commands,
exit codes, durations, logs and exact source. Workspace packages were serial and
Vitest used two workers on this 8-CPU / 16-GiB machine, bounding aggregate memory.
No dependencies or lockfile changed. A later explicit clean-head build/typecheck
also passed and preserved both the executed F1 JavaScript hash and web build ID.

## Consequential runtime and adapter checks

New tests preserve the original Improvement outcome assertions and add generic
restart/retry, uncertain-send, identity, DAG, trigger/call-cycle, scope/profile,
concurrency and stop behavior. Generic dependency proof requires original
executed `draft-pr` and `merge` **tool** receipts. Unversioned ordinary agent
aliases cannot assert merge/publication authority. Grouped repository approval
and merge sets must match exactly. Pending/uncertain delivery never releases a
wave.

Deterministic barriers cover intent-before-send/create, lost replies, child
persistence before launch commitment, concurrent admission, parent graph-end
completion, pause/cancel/restart, notification rejection during shutdown and
terminal publication retry/deduplication. Passive tracking holds no leaf execution
or shared mutation lease. A terminal failure/cancellation remains explicit;
retry retains every original accepted effect and immutable output.

## UI and compiled product

The [UI report](assets/taskbot139-actions/ui/ui.md) contains sixteen inspected
screenshots, identities and interaction receipts. Desktop and 390px light/dark
views exercise the real production server/runtime with scripted hooks. The
recipe editor saves/validates all three actions. Parent links, waves, blocked
proof, Stop/Resume and batch cancellation survive two persisted reconstructions.
No accepted receipt or gallery state was patched. Original PNGs are retained.
Root independently inspected the desktop light list and both 390px dark scroll
positions. Final UI source fingerprint
`3e297b24e1aa0cc2eb9ed3d98bd80b8658f5cc06d436bfb6b483839ca85fd272`,
web build `0a27c450bb0326b3340d8a68`, UI driver SHA-256
`65a35ed967780c164390d8995f59bec8fc0f5e138edb965d6d581a0c2aefbe62`.
All 18 captured source and eight backend inputs match the clean frozen source.
The fixture stopped cleanly at `02:24:51.570Z`. No browser fallback was needed
for this final run.

The native macOS ARM64 binary embeds Bun `1.4.2`. It was built from the clean
frozen source; executable SHA-256
`09a509003a23264e7d78d4ed6dc2f0a5a393ed54047692fd6518d570c3ac8efe`,
resource digest
`1948f0e56bfa01f415ba50537a2373d9acf7a2c4e18682ffe746418c25ebc832`.
[Build identity](assets/taskbot139-actions/native/build.json),
[canonical smoke](assets/taskbot139-actions/native/smoke.log) and
[action smoke receipt](assets/taskbot139-actions/native/action-smoke.json) retain
separate build and runtime facts. The original build's validation field remains
`pending runtime smoke`; passing smoke is recorded by these subsequent receipts. Its canonical isolated smoke
checks startup, protected API/Host/Origin policy, assets, scoped MCP, shutdown and
restart with an OS-only PATH. An additional compiled smoke persists action
configuration across restart, rejects a manual-only launch target, and exercises
pinned blob/private/foreign-repository checks through the binary's MCP process.
No native agent or real run is started in that additional smoke. Other platforms
and prepared coding-agent adapters are not claimed by this local evidence.

## Limits and recovery

See [recipe action contracts](../../../docs/factory/recipe-actions.md).
History is bounded, dated and matched to the complete repository scope; raw
logs, Git messages, prompts, credentials and personal error text are excluded.
Read-only tools cap calls/pages and reject symlinks/private paths. A Snapshot
read must retain named producer/frame provenance; renamed `@callInputs` snapshots
fail clearly rather than silently repinning. Ambiguous destination discovery
requires explicit recipe coordinates. Native Linear explicit profiles cannot
borrow native credentials. An invisible uncertain Taskbot request remains
uncertain for operator reconciliation; no blind resend occurs.

Historical improvement definitions/adapters are preserved. No production
deployment/release, credential migration, active-run editing or later-ticket
implementation was performed.

## Preliminary runs

Preliminary failures are retained separately from final evidence. New harness
corrections fixed RPC envelope/admission timing, read-only evidence-directory
lookup, required mock `questions:[]`, native request headers/status codes and
indexed snapshot format. The new F1 tracking assertions follow the real CLI
receiver/closed-ticket disposition and retain all delivery-accounting checks.
No existing fixture assertion was removed and no timeout was increased.
Production races found during that work received focused regressions before the
source freeze. Preliminary runs are not counted as passing evidence.

## Final gate repairs

The unchanged old saved-run CheckIntegration fixture lacks `questions`. The new
action projections now treat that retained field as optional (zero questions/no
question wait). A new test asserts the entire redacted history projection and
proves raw fields and personal error text remain excluded, without mutating the
retained source. No original fixture or assertion changed.

A new wait=false restart test had a load-sensitive focused failure. The unchanged
test passed alone and in the exact five-file workers2 reproduction. Its new
fixture had retained seven definitions, including five unrelated bundled recipes
(161,917 serialized bytes) in every run/child/batch. It now supplies only its two reachable custom
definitions (1,185 bytes), while the installed catalogue still retains bundled
definitions. All outcome assertions, real worktrees and five-second waits remain
unchanged. The compact exact five-file run is recorded with the final gates.

## Base verification qualification

A fresh fetch at `02:35:56Z` retained exact base/main
`791b7405f78c654c07e58c0395a4802e6229bf0a`, tree
`b896d868fe08d00f3b081f20a33ec49b9ce25edb`.
[CI / Validate 39704282012](https://github.com/jappyjan/bobs-factory/actions/runs/39704282012)
is successful on that exact SHA. Website was path-filtered out; it is not claimed
current green. A separate scheduled
[Release / 1. Build candidates 39706122085](https://github.com/jappyjan/bobs-factory/actions/runs/39706122085)
failed on this same pre-#139 source at “Validate mocked delivery, architecture
and impact recovery”; all four binary and desktop platform builds succeeded,
collect/publish were skipped. Its redirected workflow log does not reveal the
underlying assertion. Release health is not claimed green and no release fix or
publication is folded into #139. [Provider receipt](assets/taskbot139-actions/base-verification.json).
