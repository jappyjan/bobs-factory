# F1 #141 — Improve as composed recipe blocks

Date: 2026-10-22. Checkout: `taskbot-141-improve`; base HEAD
`92cdb8227468a596686fc7cdcc1ef06a0894c4af` plus working changes.

Driver: [taskbot141-improve-blocks.mjs](assets/taskbot141-improve-blocks.mjs).
Evidence: [media/2026-10-22-improve-blocks](media/2026-10-22-improve-blocks/).
This is controlled workflow evidence, not task acceptance or native-provider QA.

## Latest controlled result

The final drive completed its three scenario groups at **15:35:14 UTC**.
`results.json` records no changes to its selected source files during this run.

- Stock manual launch supplied the run model and **no worker model**. Actual
  callable roles invoked Map once, eight coordinators, eight workers and eight
  verifiers. Every research provider hook received the restricted configuration.
- Worker settings reported run-model inheritance; its exact limitation survived
  into the real Decide view. Ask invoked one targeted answer and a second
  Consolidate, with no repeated Map/worker invocation.
- Fix invoked Refine and all three independent reviews. The real Approve display
  contained the parsed plan criterion. A stale digest returned HTTP 409; exact
  explicit acceptance then filed one confirmed unassigned backlog issue and
  admitted one ordinary stock Factory child with its own worktree. Child human
  delivery decisions remained empty; it waits at `pipeline/clarify`.
- The real catalog fork changed one perspective and one copied prompt. Actual F1
  CLI create/start/view/stop commands exercised that fork, its tracker decision
  notification and paginated activity. Seven nonempty timestamped activities and
  eight tracker comments were observed; the CLI session stopped.

The preview server used **http://127.0.0.1:52759**, RPC port **52758**, PID **77318**.
It exited with code 0 at **15:44:14 UTC** after receiving its stop signal.
`cleanup.json` confirms the worker stopped and all five fixture runs are stopped.
The actual preview waits before cleanup were:

- Decide: `manual-cf8ee6fb-8c46-4065-b9f2-edd74620d9c8` (one-perspective fork).
- Approve: `manual-526509a0-0205-4821-8e24-67058bacb90c` (same fork).
- Child: `child-43f1c9fd4f3bb08f1649ce83138c4c6ff41d3b30` (stock Factory).
- Primary stock parent: `manual-d9dfcf92-983c-4214-b07c-a897a444859e`.

Stock canvas: `/#/recipes?recipe=improve-codebase`. The server was retained at
initial handoff and has now completed owned-server cleanup. Rerun the command
below to prepare new preview waits; its `preview.json` supplies fresh ports and
IDs. Root alone owns the `checks/` and `ui/` evidence subdirectories.

## Scope and command

Actual EdgeWorker, WorkflowRuntime, catalog, local Git worktrees, F1 CLI/RPC and
Factory HTTP decision handlers run in a fresh disposable home. Every provider,
including titles and child roles, uses canonical `f1AgentHandlers("mock", ...)`.
The stock manual-only trigger remains intact. A separate real catalog fork adds
ticket admission explicitly for the CLI scenario.

Run from the checkout root:

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --serve
```

Omit `--serve` for automatic cleanup after the assertions. With `--serve`, the
driver retains genuine Decide, Approve and ordinary Factory child waits until
SIGTERM/SIGINT. Its generated `preview.json` records ports, PID, IDs and the exact
owned-process stop command. It never stops another server. Temporary repositories
and homes remain available for investigation. The extra Decide/Approve previews
use the exercised one-perspective prompt fork; the primary stock scenario still
runs all eight perspectives, and the bundled stock canvas remains available.

Focused prerequisites performed in this checkout: missing EdgeWorker JavaScript
dependencies excluding already-built core; F1 CLI compilation; the owning
`pnpm --filter bobs-factory-edge-worker run build`; then
`pnpm exec tsgo -p packages/edge-worker/tsconfig.json` after the fanout fix.
No native build, broad suite, CI, authenticated service or project commit ran.
Git's only baseline commit/push is inside the fresh local fixture and its local
bare origin. Driver syntax and focused Biome checks were used.

## Preserved failed attempts

- `attempt1-cli-ping-expectation`: fixture expected the word “pong”; the real CLI
  prints “Server is healthy”. Corrected the fixture expectation. CLI output also
  contained `Status: undefined`; no product change was made for that unrelated
  formatting observation. Worker cleanup completed.
- `attempt2-initial-consolidate-missing-input`: actual Map and eight bounded
  research branches ran. Initial Consolidate failed before its provider hook:
  `For each path "/consolidate/outputs/proposals" does not resolve (missing "consolidate")`.
  Root subsequently changed optional first-round feedback mappings.
- `attempt3-fanout-operation-limit`: actual Decide, Ask → Consolidate and Refine
  ran. `plan-check` failed with `Rules exceed the evaluation operation limit`.
  Root subsequently changed explicit fanout results to produced branch outputs.
- `attempt4-approval-omits-criteria`: the rebuilt runtime reached Approve; the
  accepted display omitted the plan's separate criterion. The stock card still
  selected `/plan` rather than `/reviewText`.
  `retained-approval.json` contains the actual saved view and parsed plan.
- `attempt5-preview-preparation-timeout`: primary stock and CLI assertions passed;
  a third full stock run preparing an additional preview was still progressing at
  Consolidate when the fixture's 60-second wait expired. Cleanup completed. The
  final fixture reuses its exercised one-perspective fork for additional preview
  waits and uses a bounded two-minute wait. No runtime guard was changed.

Each runtime attempt records selected source/build hashes and retains compact failure,
permission and cleanup receipts. Duplicated full prompts and recursive runtime
archives are deliberately excluded. Runtime changes belong to root.

## Evidence boundaries

The driver checks real provider-factory configuration for the four scoped
factory-context tools, empty native tool/skill/plugin lists, one strict scoped
MCP server, read-only Codex sandbox and disabled shell/edit/delegation/web
features. Mocks prove those prepared settings reached the provider boundary;
they do not prove native CLI enforcement or actual model source inspection.

Issue filing uses a transport-free SDK-shaped shim attached to the actual
in-memory CLI tracker. No real Linear/Taskbot request is possible through it.
The child uses the normal stock Factory graph and pauses at clarification;
this drive grants no child delivery approval and claims no provider-confirmed
merge. Restart/native-session recovery and browser layout are outside this
driver's evidence; root owns the T3 preview captures.

## Integration evidence

[Focused checks and audit](media/2026-10-22-improve-blocks/checks/README.md),
[actual changed UI captures and limits](media/2026-10-22-improve-blocks/ui/README.md).
CI and repeated broad monorepo/native checks are **DEFERRED** under the latest
epic135 user acceleration policy; no overall acceptance claim is made.
