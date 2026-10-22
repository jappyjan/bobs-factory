# #141 Round6: durable Parallel Call ownership

Implementation evidence for NEW independent review of [PR178](https://github.com/jappyjan/bobs-factory/pull/178),
[Taskbot141](https://taskbot.apps.janjaap.de/p/bobs-factory/t/141). No acceptance/status/merge claim.
Full authoritative2379 found exactly one NEW R5/P2 on456154f3a75ee55bc031b6293fe4d9fd744283c7 /
tree2078198b3a98c4d0311071a5d786fb8fdb889463. R2 research repair was independently confirmed;
R1/R3/R4 were supported within that report's limits. All earlier candidates remain
historically NOT CLEAN. Full141/135, reports2306/2321/2344/2360/2369/2379,
scope2320/baseline2361 and the latest functional/logical/performance threshold remain review context.

Actual execution: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`,
branch `taskbot/141-improve`; T3 coordinator binding unchanged. Node24.21.0/pnpm10.33.1.
Latest remote main/base92cdb8227468a596686fc7cdcc1ef06a0894c4af /
treeb808a78f4e95f463b0285808141c5eb929e022d2 verified by Git metadata, without CI.
Final candidate HEAD/tree and normal hooks are recorded in the PR/ticket handoff.

## Functional repair

At4561, modern Parallel requested produced-only `frameResults` at WorkflowRuntime.ts:2530
but its branches inherited only the parent's `projectResults` flag (:2420).
A top-level modern frame has no such flag. Ordinary Call completed its child once,
but the branch did not record the Call's owned container result (:3798); projection
then correctly rejected the missing ownership (:5252–5255). Legacy completed.

The same explicit Parallel configuration now enables branch `projectResults` before
the existing durable save and branch execution. Existing unfinished branches receive
the flag too. The existing graph-entry restoration and step-completion mechanisms
record exact qualified receipts; no ownership guard, scope/frame validation or
inherited-output exclusion is bypassed. Call/For each/Launch/native/human/provider
guards, history, generic limits, schemas and legacy aliases are unchanged.
No format-name/step-ID privilege or hidden Improve route was added.

The genuine unfinished fixture was captured with unmodified4561 after the child's
accepted result was saved and before Call completion. Its exact checkpoint, history,
outputs, attempts, workflow and events are retained; only nine unrelated unused
catalog definitions were omitted. No flag/receipt/authority was patched to simulate
history. The raw synthetic capture stays at `/tmp/taskbot141-r5-unfinished-4561.json`;
[provenance](media/2026-10-22-improve-blocks/repair-parallel-call/checks/provenance.json)
records its hash and exact field comparison. This is runtime reconstruction,
not process-crash/native-session proof.

## Focused checks and retained failures

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/ParallelCallOwnership.test.ts
pnpm --filter bobs-factory-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/ForeachOwnership.test.ts -t 'projects only produced outputs|fails closed before approval when an older completed wrapper|separates identically named'
pnpm exec tsgo -p packages/edge-worker/tsconfig.json
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --parallel-call-fixes
pnpm --filter bobs-factory-edge-worker exec vitest run test/ImproveRecipe.test.ts -t 'executes nested research'
```

- Before repair: corrected fixture gives one failed modern completion assertion
  with the exact missing-container error; legacy completes. Genuine unfinished
  checkpoint capture passes. Initial test setup omitted required bundled defaults:
  two setup failures before runtime execution, retained separately.
- After repair: **2 new tests PASS**. Modern ordinary unmapped Call completes once,
  legacy output aliases remain. Genuine unfinished4561 recovery invokes no agent,
  preserves the original history prefix and one child/Call receipt, excludes
  inherited seed output and remains completed after another disk reload.
- **3 existing guard tests PASS**,151 skipped: modern produced-only/legacy fanout,
  cross-frame output authority exclusion and fail-closed missing completed-container
  ownership. No assertion/timeout/receipt guard was weakened.
- **1 stock composed test PASS**,1 skipped,23.05s test time, original90s deadline.
  It retains Ask without research replay, cycle/security correction and all3
  reviews, exact approval/stale/request-change/reconstruction checks, issue filing
  and BOTH exact human/provider-backed dependency waves with full canonical child
  tasks/original receipts. This shared-Parallel integration check was run once.
- Necessary owning edge TypeScript compile passed. Driver syntax, focused Biome
  and diff whitespace passed; broad manual cycles were not run.
- First custom F1 fixture copied `inputs` rather than `launchFields`; launch was
  correctly rejected400 before any run existed. Failure/HTTP/cleanup are retained
  under [attempt1](media/2026-10-22-improve-blocks/repair-parallel-call/attempt1-launch-fields/).
  Corrected fixture uses the real launch contract; product code was not changed for it.

[Small check logs](media/2026-10-22-improve-blocks/repair-parallel-call/checks/)
normalize terminal blank lines only; raw originals remain at the recorded `/tmp` paths.
**Six current product tests passed**, plus the small F1 scenario below. Initial
setup/negative outcomes remain failures, never relabelled as green evidence.

## Actual EdgeWorker path

One disposable custom modern recipe runs Snapshot → Parallel → mapped Call to a
reusable read-only `json-v1` agent. Real catalog PUT, manual HTTP launch, EdgeWorker,
WorkflowRuntime, canonical mock runner, pinned Snapshot context and prepared provider
restrictions execute. Exactly one actual provider hook runs with the existing four
read-only context/repository tools, no native shell/web/delegation or paid model.

Run `manual-5c49a4bc-42f9-45a8-ba83-09f4504f02f1` completes. Qualified agent and Call
history contain the full child JSON exactly once; the final Parallel projection
contains only the owned Call result, excluding the inherited Snapshot. No human
decision, issue filing or child Factory run. Durable completion is flushed and the
own worker/server stops. Unmapped ordinary Call and reconstruction are exercised
by the owning tests, not claimed for this mapped F1 scenario.

[Actual proof](media/2026-10-22-improve-blocks/repair-parallel-call/repair-proof.json),
[provider turn](media/2026-10-22-improve-blocks/repair-parallel-call/turns.json),
[HTTP/CLI receipts](media/2026-10-22-improve-blocks/repair-parallel-call/http-cli.json),
[source/emitted/driver identity](media/2026-10-22-improve-blocks/repair-parallel-call/identity.json),
[results](media/2026-10-22-improve-blocks/repair-parallel-call/results.json),
[cleanup](media/2026-10-22-improve-blocks/repair-parallel-call/cleanup.json).

Drive ran dirty repair atop4561, not a clean-commit/native drive. All18 selected
sources are identical before/after;17 match the prior research drive exactly, only
WorkflowRuntime differs. Post-hook authentication in the handoff compares current
source/emitted/driver bytes with these actual executed receipts. No new UI behavior
or prompts changed, so exact unaffected research/CLI/fork/UI evidence is carried
forward rather than replayed. Mocks prove orchestration/prepared permissions,
not native enforcement, paid inference, process-crash recovery or live merging.

## Complete criterion disposition

These are implementation evidence dispositions awaiting independent review, not clearance.
Detailed earlier rows/receipts remain in the [Round5 matrix](2026-10-22-improve-blocks-round5.md)
and [Round4 matrix](2026-10-22-improve-blocks-round4.md), with2379 qualifications.

|141 requirement / epic row|Current evidence and limits|
|---|---|
|Honest stock graph/canvas; ordinary generic execution|Stock definitions unchanged; current composed flow passes. R5 ordinary modern Parallel Call and legacy control now pass; independent review pending.|
|Snapshot WITH run history → one read-only Map|Pinned whole-scope/history/read bindings unchanged; current F1 executes real pinned Snapshot/read-only preparation.|
|Eight original perspectives/filter/output substance|Exact unchanged library/prompt inputs; original eight-perspective proof reused. No prompt assertions changed.|
|Concurrency4/keep-successful/coordinator≤2/nested workers/verifier|Research parser/prompt/For each unchanged;2379 confirms corrected complete arrays, two workers/verifier and legacy behavior. Original concurrency/partial-success proof reused.|
|Consolidate0–5/stable IDs/prior revisions/answers/decisions|Unchanged formats/config; current composed scenario retains stable proposals and revisions.|
|Decide Fix/File/Skip/Ask and dedicated targeted Ask→Consolidate|Current composed counts/history retain no research replay; ordinary routes/reads unchanged.|
|Refine complete plans/exact selected IDs/prerequisites|Current composed coverage retained; prior large ASCII/UTF8/escaped and malformed-coverage proofs reused, no transport/schema/work-limit changes.|
|Three parallel reviews/Check failure→Refine→pass; complete DAG|Current cycle→Refine and security failure→Refine/all3 reviews pass; both repaired whole-plan Check transports unchanged.|
|Digest-bound Approve plans+checks+graph/request changes→Decide|Current composed stale/exact/reconstruction checks pass; actual graph display/source/final digest source/test inputs unchanged from independently supported2379.|
|Parallel File issues vs Factory Launch/dependency order/wait/tracking|Current issue/two-wave controlled proof passes; exact human AND provider prerequisites required, no completion-as-merge. Old actual stock child/confirmed mock backlog receipt reused.|
|Full canonical reviewed text/criteria/paths/dependencies → child|R1 mapping unchanged; current composed BOTH child inputs/launchInputs equal accepted complete tasks; original receipts preserved.|
|Optional worker model/inheritance visibly noted|Accepted run-model behavior and read-only capability preflight unchanged; actual previous two-worker receipts/visible limitation reused.|
|Manual default/optional focus/editable triggers|Stock launcher/catalog unchanged; current custom launch uses real editable launchFields.|
|Four standalone workflow/manual subrecipes/palette|Declarations/closures unchanged; current modern Parallel→reusable recipe composition succeeds.|
|All bundled reachable closures forkable exceptSimple|Catalog/UI closure rules unchanged, actual edited perspective+prompt/renamed-role and CLI receipts reused. Factory/Takeover otherwise unchanged pending142.|
|Full mocked E2E/restart/retry/idempotency/concurrency/stale|One current stock composed scenario plus current genuine unfinished recovery and unchanged relevant original receipts; no native-crash/overall acceptance claim.|
|Old executor/orchestration/settings/schema/trigger/preflight/state/endpoints/hooks/web/CSS deleted|All required deletion rows unchanged; no migration. Shared generic providers/read-only/native stores/uncertain action reconciliation preserved.|
|No leftover special improvement authority|Prior independently reproduced34 legitimate library/recipe/raw-alias/prompt/user-text matches; no new special executor/state/endpoint introduced.|
|Frozen non-Improve runs/forks/native conversations/evidence/decisions|Genuine frozen modern checkpoint recovery retains accepted result/history without replay; legacy control and existing missing-ownership fail-closed guard pass. Other frozen/native guards unchanged.|
|Screenshots desktop390/lightdark/360/keyboard; relevant F1|No changed UI; exact relevant prior canvas/run/Details captures and measured keyboard/overflow receipts reused within original limits. Current small mocked F1 above; no new browser/native claim.|
|Capability/entire expected prompt/role fixture/changelog/docs|No new capability or prompt change; complete maintained expectations unchanged. Existing actualPR178 changelog updated for functional recovery; current report added.|
|Epic decisions1–8|Universal forks exceptSimple; generic blocks; library/custom schemas; inert declarative views; targeted Ask; outright deletion; inherited model; base merged140/no142+ all retained.|
|One linked latest-main PR/independent review/guarded squash|Same PR178/main; final exact head/tree/base in handoff. Parent owns NEW exact-head separate Standards/Spec review/status/guarded[skip ci] merge.|
|Full-suite/CI/broad/native/integrated cleanup|**DEFERRED**, not passed, under latest user policy until post148. Actual normal hooks separately recorded; no manual replay.|

Inherited64k text fallback explicitly marks omission/requires complete dashboard
review; literal FULL text remains historically PARTIAL under2320. Only unused
nondisplayed Approve Snapshot read was removed previously under2361; actual pinned
role/history/currentness contexts remain. No pagination/new framework/limit widening.
Earlier negative/setup/maxima/locator/EOF qualifications remain historical.
No dependency/global policy/protection/production/active-run/release/deploy/142+ effect.
No CI query/trigger/watch/poll/retry/finalization or repeated broad/native cycle.
Cosmetic cleanup/optional hardening remains deferred under the user's current threshold.
