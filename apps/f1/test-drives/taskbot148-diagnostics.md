# Task148: execution, waits and bounded diagnostics

Date: 2026-10-23. Implementation evidence for Task148 under epic135; independent
Standards/Spec acceptance and guarded merge remain coordinator-owned.

## Combined Round1 corrections — implementation candidate, acceptance pending

The original `a6dd68b310768d7209986e78ace3183e6fb4fe39` / tree
`78c51673d3bd2944249dbe6842f2cb70fe3597d6` is **NOT ACCEPTED**. Authoritative
Task148 comment2600 was read in full and independently byte-authenticated here:
34260 UTF-16 units /34313 UTF-8 bytes, SHA256
`cb20fd1420d6df892c0ca3b3da36a3021808fe733294029cf63995e1e22f79f7`.
Standards0, Spec3 P2 and root1 additional P2 remain their original axis provenance;
this implementation response is not a new review or inherited clearance. SAME PR185,
original BASE/tree, one combined repair commit. Final exact commit/tree/sole-parent
and full original diff/log digest are recorded in the PR and Task148 handoff.

| Finding | Combined repair and focused observed result |
| --- | --- |
| P148-R1-S1 — Spec P2 | Persisted capacity leaves remain scheduling/fairness records. Only process-local callbacks establish live capacity/execution; parked queues do not measure wait. Real runtime reconstruction holds preparation with restored executing and parked records: execution/wait/role totals stay0, recovery remains observed, saved leaves unchanged. Pure clock case retains prior1s totals, then measures fresh eligible wait1s and generic execution2s. |
| P148-R1-S2 — Spec P2 | Capacity never synthesizes a role. Actual EdgeWorker turns carry original attempt identity; duplicate observations of one turn count once. Real question-explanation path changes stepKey while inheriting the parent's capacity callback: one2s scripted runner yields execution2s/role2s. Original blocked output/native checkpoint/answers are unchanged by explanation; exact subsequent human answer is retained. |
| R148-R1-01 — root additional P2 | Generic discovery/transport lease with zero agent turns produces execution2s/role0. Actual Simple source runner boundary under a mocked owner produces execution2s/role2s and clears the observation on exit. No key/provider/prefix dispatch decides whether a lease is an agent. |
| P148-R1-S3 — Spec P2 | Grouped claim ownership is unchanged. Every actual blocker target is classified; QA-only, repository-only and both are exercised through real reservation acquisition. QA-only2s has no repository total. Both2s then repository-only2s yields QA2s/repository4s/exclusive wait4s; one subsequent1s role adds execution1s, never double-counting the waits. Same claim object/scopes remain atomic through admission/release. |

The production changes touch only RunDiagnostics, its Runtime boundary owner and
EdgeWorker's explicit agent/Simple attribution. Native continuity, original human
decisions, visit/command/progress limits, admission eligibility/fairness/exclusion,
resource ownership and QA/provider/currentness/final-proof authority are retained.
No old aggregate or original receipt is rewritten/backfilled; historically incorrect
observations remain historical rather than being relabelled repaired evidence.

### Current commands and exact evidence scopes

All commands use the retained own checkout, original Node24.21.0 and existing
pinned pnpm10.33.1 tooling. No install or dependency change was needed. `sh
.task148/check.sh` isolates HOME/TMPDIR/config and clears inherited environment.
The selected new harness was inspected before execution: only own synthetic runs,
mocked runners, private temporary files, real local runtime/reservation boundaries;
no provider/native/store/production I/O. No edits occurred while checks ran.

```sh
sh .task148/check.sh env F1_AGENT_MODE=mock node   packages/edge-worker/node_modules/vitest/vitest.mjs run   --config apps/f1/test-drives/assets/taskbot148-diagnostics/vitest-repair.config.ts
# exit0: 14 tests, only RunDiagnostics7 + DiagnosticsBoundariesF1 seven source/mock seams
sh .task148/check.sh env F1_AGENT_MODE=mock F1_RESULT=<own-private-TMPDIR>/repair-f1-summary.json node   packages/edge-worker/node_modules/vitest/vitest.mjs run   --config apps/f1/test-drives/assets/taskbot148-diagnostics/vitest.config.ts DiagnosticsF1.test.ts
# exit0: 1 affected nested/parallel/capacity/QA/CI/human/reconstruction/API drive
sh .task148/check.sh node node_modules/@typescript/native-preview/bin/tsgo -p .task148/tsconfig-edge.json
# exit0: changed owning production source aliases; no broad/native gate
sh .task148/check.sh node node_modules/@biomejs/biome/bin/biome check <six changed TS/config paths>
# exit0: 6 files; no fixes
```

Actual executable in every invocation above: `/run/current-system/sw/bin/node`.
[Current14-test log](assets/taskbot148-diagnostics/repair-focused.log),
[current affected F1 log](assets/taskbot148-diagnostics/repair-original-drive.log),
[current F1 receipt](assets/taskbot148-diagnostics/repair-f1-summary.json),
[current type/format logs](assets/taskbot148-diagnostics/repair-types.log).
F1 invoked exactly `nested/parallel/0/left`, `nested/parallel/1/right`, `provider`,
one Check; execution5s/exclusive wait5s/role5s; per-reason unions capacity3s/QA2s/
CI1s/human2s. Original frozen workflow/history/checkpoint/pending exact decision
retained; no role replay; stale digest409/exact approval200; limit32/API10816 bytes.
This current drive used the own existing generated web shell; it does not turn the
reviewer's missing-own-web-shell setup failure into a pass. No web/native rebuild.
The repair seams add actual question-explanation and Simple runner starts plus
three atomic combined-reservation scenarios; generic lease has0 agent turns.
No live providers/inference, arbitrary OS crash, physical devices or cost/savings
claim. All synthetic runtime/gate/transport lifetimes close in cleanup.

Retained new draft failure: the first repair run passed11/12 but its grouped fixture
timed out30s. It attempted to acquire a later repository claim ahead of an already
eligible grouped waiter; existing fairness correctly prevented it. The fixture now
establishes owners before admission and tests their release. No product fairness or
generic limit changed. [Actual failed log](assets/taskbot148-diagnostics/repair-focused-first.log)
remains. Initial direct execution of the non-executable check wrapper failed126;
invocation was corrected to `sh` without changing its mode. Initial changed-file
Biome found an assignment-expression violation; fixed, final6-file check passed.
Historical implementation setup/type/draft errors and review root transform/setup
errors remain historical failures, never current correctness passes. Final staged
`git diff --cached --check` exits2 only for trailing blank lines in three raw
test logs; their actual bytes are preserved, with no source whitespace finding.

### Authenticated reuse and failures

[Repair source/harness/evidence hashes](assets/taskbot148-diagnostics/repair-source-freeze.json)
authenticate all current sources and explicitly identify changed versus unchanged
original manifest entries. The unchanged capability text, entire prompt fixture and
prompt test are authenticated and their earlier3 passes reused; no prompt changed
or prompt matrix rerun. Context implementation/test bytes are unchanged; original
and independent SDK6-page/81498-byte evidence is reused without rerunning counters.

All8 original UI PNGs and the4 UI source files/fixture/capture inventory are unchanged
and rehashed. Captures remain **retained pre-repair UI evidence**, not fresh proof of
restoration/role/blocker repairs. Original build c51af697e48778466254d4e5 / app
57f19fabedfe7f7dbb879571, synthetic10-day/1m/2m fixture, desktop/390 light/dark,
reported0 overflow, browser scaling and disclosed PWA banner limitations all remain.
No unchanged UI matrix/build/research/native proof was repeated. Development runtime
commit remains unknown; neither source nor mocked runtime is installed delivery.

QA `TypeError: allowed is not a function` remains **FAIL**. An unchanged fixture is
not proof that BASE fails. Known3 ReviewFiles/TicketDelivery fixtures remain
**FAIL/deferred**; external missing-final-proof negative remains **not delivered**.
No prohibited Call fixture or forbidden temporary diagnostic was accessed. ALL
CI/check/status-rollup/workflow/main-health/provider-finalization queries, triggers,
watches, polls/retries/waits and broad/full/native cycles remain deferred after149.

### Complete current Task148 / epic1–8 / DoD disposition

| Task148 requirement | Current implementation disposition (NEW independent acceptance pending) |
| --- | --- |
| Explicit execution and every wait/recovery/unknown receipt | Current14+1 focused evidence covers repaired boundaries and actual QA/repository intersections; bounded sidecar remains. |
| Separate age/accounted totals/current blocker/resource/duration | Existing UI/API unchanged; current source/runtime boundary checks repair truthfulness. Retained8 captures have limits above. |
| Repeated role/check counts, visit reason and evidence reuse | Original111 owner/attempt/reuse references retained; current source hashes and original provenance6 pass reused. No authority derived from counts. |
| Nested/parallel unions and distinct role sum | Current accounting/control/real-runtime mocks pass; distinct actual attempts count once, generic leases0role. No inference claim. |
| Restart/rollback/repeated admissions/legacy gaps | Current reconstruction/preparation and eligible callback/parked controls; current pure prior totals/rollback/gap checks. No downtime credit or rewritten schedule/evidence. |
| Context page/UTF-8 metrics and honest provider usage | Exact unchanged counter sources/tests and earlier independent6/81498 proof reused. Null/unknown attribution unchanged. |
| Protected bounded API/export/generic view/no secrets/full-run scans | Current1000-transition throwing-getter case and actual API cap32/10816-byte response; existing auth/origin boundary retained. |
| Controlled wait/reconstruction/concurrency proof | Current14 owner/accounting tests +1 affected mock/API drive. No arbitrary OS/native/live certification. |
| Ten-day short execution/actual blocker and desktop/390 themes | Retained exact8 images authenticated, not new repair-path captures; UI sources unchanged. |
| Frozen definitions/forks/native/evidence/obligations/exact decisions | Current reconstruction and explanation tests retain original objects/checkpoints/answers; production guards unchanged. |
| Generic stable identities/no87/no149 | No role inference by names/prefixes/providers; actual scoped blockers and full step/attempt identities. No new platform/restrictions. |

| Epic decision / DoD | Current disposition |
| --- | --- |
| 1. Fork every bundled recipe/sub-recipe except Simple | Definitions/catalog policy unchanged; source preservation, no fresh catalog matrix. |
| 2. Generic configured agent/Check/flow/human/actions | Instrument existing owners; no new authority/budget/admission semantics. Current explicit runner and generic lease controls. |
| 3. Library and custom JSON Schema formats | Validators/formats unchanged; full original prompt/fixture hashes authenticated, earlier passes reused. |
| 4. Inert declarative views | Existing tables/UI unchanged; normal auth/decision digest independent. Original8 captures retained. |
| 5. Dedicated Ask follow-up then consolidation | Actual explanation source path tested with inherited admission and changed key; original decision/native blocked output preserved. |
| 6. Delete old Improve, preserve accepted other runs/forks | No routine restored or graph upgrade. No fresh Improve matrix or inherited clearance. |
| 7. Research model inherits when unset | Selection/default owners unchanged; no provider/model inference or research rerun. |
| 8. Foundation-first sequence | Only148 samePR repair;149 not started; parent owns148→149→one consolidated validation. |
| Isolated latest-main ready PR/exact review | SAME185 originalBASE, one combined repair commit; original rejected head retained historically. NEW whole-original-diff root/two-axis acceptance pending parent. |
| Focused tests/currentness/permissions/native guards | Current14+1 plus exact reused scopes above; recorded QA/3 failures and missing external proof remain. No delivery guard waived. |
| Capability/changelog/docs | Capability/prompt unchanged and hashed; same185 changelog entry and maintained timing docs/report updated. |
| F1/UI | Current narrow mocks/affected API reconstruction pass; retained eight UI captures, no fresh UI/native claim. |
| CI/full gates/final cleanup | Deferred, not passed; every subject [skip ci], no saved workflow/protection/security changes. |
| Human/provider/external/native delivery | No self-clearance/approval/merge/status/deployment. Parent owns further reviews/guarded delivery. |

No helpers or pending children. Own hooks were never displaced and all4 executable
hashes match the original; no restoration obligation in this implementation checkout.
The review checkout's separately recorded hook-restoration obligation is outside
this owner's scope and remains untouched. Normal post-commit/pre-push/LFS stay on;
only authorized command-local commit.gpgsign=false is used. No saved signing/auth/
remote/security configuration or private/native stores inspected/changed. Own
synthetic HOME/TMPDIR/config roots and test processes/transports/timers are cleaned
before handoff; no preview/browser/service was started for this repair. Clean own
checkout is retained. Manual worktree creation still does not rebind inherited T3.
Actual start/end readbacks remain codex/gpt-6.1-sol/priority(Fast)/xhigh/full-access/default.

## Historical initial implementation record (pre-repair)

The following initial evidence remains retained at its recorded source/build scope;
it does not supersede Round1 NOT ACCEPTED or certify the combined candidate.

Ready PR: [#185](https://github.com/jappyjan/bobs-factory/pull/185). The GitHub
connector lacked PR-write permission (403); authorized existing GitHub CLI
authentication created the open/non-draft PR. Both T3 threads and Task148 are linked.

Base: `5a97d7099b74f50103320daf5aa915df05edb9ad`, tree
`d0dae3b9a3305eab72b7802c35da1166c15e4ed9`. Fresh provider/main and MAINONLY
`--no-prune --no-tags` fetch agreed before implementation and publication.
Own checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-148-diagnostics`,
branch `taskbot/148-diagnostics`. Manual creation did not rebind T3: its inherited
binding remains the coordinator worktree. No product/install/source/test/Git command or mutation ran in another
owner's checkout. Initial read-only cwd/environment inventory preceded worktree creation. Configuration was actually read: codex / gpt-6.1-sol /
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
