# Task148: execution, waits and bounded diagnostics

Date: 2026-10-23. Implementation evidence for Task148 under epic135; independent
Standards/Spec acceptance and guarded merge remain coordinator-owned.

Base: `5a97d7099b74f50103320daf5aa915df05edb9ad`, tree
`d0dae3b9a3305eab72b7802c35da1166c15e4ed9`. Fresh provider/main and MAINONLY
`--no-prune --no-tags` fetch agreed before implementation and publication.
Own checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-148-diagnostics`,
branch `taskbot/148-diagnostics`. Manual creation did not rebind T3: its inherited
binding remains the coordinator worktree. No command or mutation ran in another
owner's checkout. Configuration was actually read: codex / gpt-6.1-sol /
serviceTier=priority (Fast) / reasoningEffort=xhigh / full-access / default.

## Audit and changes

Task148 pickup and pre-change audit are recorded in ticket comments2595/2596.
Reused #111 StepAttempt reasons/outcomes/runtime/workflow/contract/instruction
identities, #146 actual capacity/reservation boundaries and fairness ownership,
#147 progress/Continue authority, #144 immutable context snapshots, pagination and
preparation cache, and #140's declarative tables. No #87 telemetry platform or
#149 transcript restriction/cumulative allowance is implemented.

A bounded sidecar records interval-union totals, current state/resource/blocker,
recent transitions, original attempt references, reuse links, context page/UTF-8
response counters and available reported usage. Run age, exclusive wait, overlapping
per-reason waits, agent-role sums and unknown gaps have distinct labels. Five-second
observations use monotonic time and do not extrapolate through restart or a stopped
observer. Original provenance/evidence/native sessions/decisions remain canonical.
See [timing semantics](../../../docs/factory/diagnostics.md).

## Focused proof

All test/setup commands used the own checkout and private HOME/TMPDIR/native config
roots through `.task148/check.sh` (`env -i`; original Node24.21.0 and direct pinned
pnpm10.33.1 launcher). No paid/live provider, native model, production run, device,
release or deployment call occurred.

Actual preparation: pinned `pnpm install --frozen-lockfile --ignore-scripts` exit0;
core `tsgo` exit0; owning MCP `tsgo` exit0. Web preparation initially lacked five
existing runner `dist/formatter.js` entries; only those formatter source entries
were bundled. The owning web build then succeeded. No full/native runner build.
The initial SSH fetch failed128/publickey; command-local HTTPS URL rewrite plus
existing `gh auth git-credential` succeeded0 without saved transport/auth changes.

Current commands and outcomes:

```sh
node packages/edge-worker/node_modules/vitest/vitest.mjs run \
  --config apps/f1/test-drives/assets/taskbot148-diagnostics/vitest.config.ts
# exit0: 9 tests (5 accounting + 1 mocked F1 + 3 entire role/capability prompt tests)
F1_CONTEXT_METRICS=1 node packages/mcp-tools/node_modules/vitest/vitest.mjs run \
  --config packages/mcp-tools/vitest.config.ts \
  packages/mcp-tools/src/factoryContextMetrics.test.ts
# exit0: 1 MCP transport/counter test
node node_modules/@typescript/native-preview/bin/tsgo -p .task148/tsconfig-edge.json
node node_modules/@typescript/native-preview/bin/tsgo -p .task148/tsconfig-web.json
# both exit0: owning source-alias checks, including existing node:sqlite declaration
node packages/edge-worker/scripts/build-factory-web.mjs
# exit0: c51af697e48778466254d4e5
```

The source-alias configurations avoid unrelated package/native builds. The original
unprepared edge tsconfig failed on missing package declarations; early temporary
config attempts also failed on web exclusion/type-root preparation. These are not
passed broad gates. Final checked configurations and their hashes remain in the
own ignored `.task148` audit folder. The committed focused config selects only the
three relevant files and cannot pick up the two prohibited fixtures by default.

The initial F1 draft caught an undefined new bookkeeping parameter, which was
fixed. Later fixture failures corrected a notification race, an incorrect summed
capacity expectation (the union is3s), and using a different wall clock in API age.
Production accounting was not changed to turn a summed fixture into a union pass.
The final published-fixture run passed. The focused prompt test compares the entire
capability text and every entire expanded stock/frozen role prompt; no partial
prompt assertion was added. Existing prompt assembly/components/types were not
changed.

Earlier current checks: six existing `FactoryProvenance.test.ts` tests passed;
one selected normal command-budget test in `Impact.test.ts` passed. A selected
existing behavioral QA-reuse fixture failed first for missing MCP preparation, then
with `TypeError: allowed is not a function` in its fixture's `require('./src/auth.js')`
command. Its test source is unchanged from base. The second failure is retained in
[the actual log](assets/taskbot148-diagnostics/qa-reuse-current-failure.log); it is
not a pass or a new blanket baseline clearance. The coordinator's three known
baseline failures remain failed/deferred until consolidation. Neither prohibited
Call fixture was executed, and none of the three forbidden temporary diagnostics
was accessed.

### Mocked runtime/API drive

[Harness](assets/taskbot148-diagnostics.mjs),
[receipt](assets/taskbot148-diagnostics/f1-summary.json),
[focused log](assets/taskbot148-diagnostics/focused.log).

Real WorkflowRuntime, resource reservation and authenticated Factory API; scripted
capacity notifications, agent hooks and provider wait; controlled clock. Invoked:
`nested/parallel/0/left`, `nested/parallel/1/right`, `provider`; one generic Check.
Execution5s; exclusive wait5s; role wall5s. Per-reason unions: capacity3s,
shared QA2s, CI1s, human2s. Capacity and resource waits overlap execution and are
not summed into run wall time. A separate pure controlled-clock case proves two
simultaneous agent roles produce a union rather than a sum.

Reconstruction retains frozen workflow/history/checkpoint/native identity fixtures
and the exact pending human decision; no prior role replay. A stale approval digest
is rejected409; the original exact explicit approval succeeds200. The bounded API
caps an oversized request at32 and returned10824 bytes. A long-lived synthetic
1000-transition test retains64 records, bounds the export and uses throwing lazy
history/output/attempt/workflow getters to reject any full-run access. Controlled
cases also cover repeated admission, repository waits, transport backoff, rollback,
restart, delayed observation and old gaps. No real process-crash survival, native
inference timing, real-provider judgment or fixed savings claim is made.

### Actual context retrieval

The real SDK MCP client/server over two in-memory connections delivered6 successful
pages: 4 reads, 2 lists, 4 full pages, **81498 UTF-8 JSON response bytes**. Repeated
reads and aliases count again; failed reads do not add delivered pages. Recorded in
[the measured log](assets/taskbot148-diagnostics/context-counters.log). This is
context response volume, not provider token/cost attribution or all filesystem I/O.

### Current UI

[Capture inventory + hashes](assets/taskbot148-diagnostics/ui-captures.json).
Eight inspected captures cover the two changed areas (Working row and run timing),
1440×1000 desktop and390×844 CSS viewport, light/dark. No horizontal page overflow
at390px. Browser screenshots use device pixel scaling; these are responsive browser
checks, not physical-device evidence. Current API build and loaded script were read:
`c51af697e48778466254d4e5`, `app.57f19fabedfe7f7dbb879571.js`.

The [UI fixture](assets/taskbot148-diagnostics-ui.mts) uses actual runtime/API/web
assets, scripted title/roles and controlled time: an explicitly synthetic ten-day
run has1m execution,2m observed Docker wait, unknown older time, two inspection
visits and one Check. A separate synthetic reservation owner is the real blocker.
Counters are0 because these scripted roles do not invoke a context MCP server.
The run is not production evidence. Some detail captures retain the local PWA
update-available banner from earlier test-shell builds; the rendered script and
API build were independently verified as the final build above. No updater code,
production service or installed binary was changed. Development runtime identity
reports version0.2.73 with unknown commit; source merge is not deployment proof.

## Task148 and epic dispositions

- All148 outcomes: explicit timing/recovery receipts and unknown gaps; separate
  age/current blockers/repetition/reuse; nested unions and role sums; restart,
  rollback/repeated admission; UTF-8 context counters and honest usage; bounded
  protected export and generic UI. Scoped proof above; native/live limits retained.
- Epic1 configurable agents: existing reads/formats/rules/contracts/permissions
  remain their owners. Added diagnostic counters do not restrict #149 access.
- Epic2 Check: leaf timing and recent counts; evaluation/evidence authority unchanged.
- Epic3 For each: existing stable lexical identities retained by inspection; no
  separate new For each drive is claimed. Nested/parallel timing is exercised.
- Epic4 actions: existing side effects/reservations preserved; no live publication,
  issue filing, child launch or external action is authorized by diagnostics.
- Epic5 views: existing declarative table renderer reused; protected decision digest
  remains independent of diagnostics. Current responsive/theme evidence included.
- Epic6 Improve/forking: bundled definitions/fork policy untouched; no Improve run.
- Epic7 Factory/Takeover calls: accepted definitions and call identities retained;
  nested/parallel/reconstruction proof is mocked, not live provider validation.
- Epic8 human views: original pending exact decision retained across reconstruction;
  stale approval rejected. No answer, approval or gate is fabricated by telemetry.
- DoD: one latest-main isolated ready PR; actual PR/changelog link and source/harness
  inventory accompany publication. NEW independent whole-diff Standards/Spec,
  guarded squash and ticket status remain pending coordinator work.
- Broad monorepo/full/native build/type/lint/package/app/script/audit cycles and ALL
  development CI/check/status/finalization queries/triggers/watches are deferred
  under the epic override, not passed. No workflow/protection/security setting was
  disabled. Product WatchCI/Handoff/QA/human/provider/final delivery checks remain.
- No dependency manifests/lockfile changed. No helper delegation or pending children.
  No #149 implementation/pickup. Epic135 remains open through #149 and consolidated
  cleanup/validation. No self-clearance, status transition or merge.

## Ownership and shutdown

The own API/runtime was stopped after capture; shutdown clears accounting timers,
SSE and blocked reservation work. MCP clients/servers/transports close in finally.
The preview navigates away so no application query timers remain. No other-owner
home/checkouts/hooks were cleaned. Own generated LFS hooks stay intact. Local
non-executable ignore files keep only own generated hook files and `.task148`
artifacts out of git status; no executable hook or saved Git config is altered.
There was no generated pre-commit wrapper to run broad gates, and no hook-pass or
absence-based validation credit is claimed. Normal post-commit and pre-push/LFS
hooks remain enabled. Scoped publication uses only command-local
`-c commit.gpgsign=false`; no signer/key/auth configuration is inspected or changed.
