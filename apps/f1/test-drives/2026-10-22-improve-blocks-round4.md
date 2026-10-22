# #141 Round4 R2 Check transport repair

PR [178](https://github.com/jappyjan/bobs-factory/pull/178), Taskbot [141](https://taskbot.apps.janjaap.de/p/bobs-factory/t/141).
Implementation packet for **NEW independent acceptance**, not clearance.

Authoritative2360/clarification2361 completed both independent axes on immutable
a272320783b1f2abfc037f5b17d36dc61ddf6902 / tree9b03f9964ebb3affd423d7d207524b8704c975ac.
Exactly one unique residual P2 remained: R2 at **both** whole-plan Check handoffs.
R1/R3/R4 were independently supported within that report's limits. Historical
4754/9621/118b/a272 remain **NOT CLEAN**; no verdict is inherited by this repair.
Original141/135, reports2306/2321/2344/2360, scope2320 and clarification2361 remain
required review context. Earlier failures, raw probes, receipts and screenshots
are preserved unchanged.

Execution: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`, branch
`taskbot/141-improve`; coordinator/T3 binding untouched. Node24.21.0/pnpm10.33.1.
Latest base is92cdb8227468a596686fc7cdcc1ef06a0894c4af /
treeb808a78f4e95f463b0285808141c5eb929e022d2, verified through Git metadata only.
Final published HEAD/tree and actual hook outcomes are recorded in the PR/ticket
handoff rather than creating a self-referential evidence commit.

## Cause and narrow correction

Public JSON admissibility and Check work admissibility differ. Five parsed stock
packages, each approximately39907 JSON bytes, fit the existing1/16 plan share but
the stock Check `select` expressions canonicalized all complete/derived prose.
String encoding charges six units per character, then recursive assembly, parsing
and emitted footprint consume the shared1,000,000 work allowance. The exception
occurred before `passed:false` could route to Refine; Retry retained the same data.
The previous positive scope test prepared the later Check's output and missed both
intervening receiving boundaries.

Exact **a272** anchors: improvementWorkflow.ts:389 (plan-inputs whole-plan select),
:502 (plan-check whole-plan select; :501 is feedback); Rules.ts:644 string
prepayment, :668/:699 nested assembly, :1147 parsing, :349 fixed work ceiling.
OutputFormats.ts:82–90 uses the actual sanitizer; :115–124 applies the plan16 share.
These correct earlier provisional anchors2350/2359 without changing the finding.

Only two stock collection expressions change: complete plans now use the existing
`aggregate: "filter"` with no predicate at each handoff. ID uniqueness, exact
membership/count, item identity and retained prerequisite predicates still inspect
their original bounded metadata paths. The complete packages remain available to
the DAG Check, all three reviewers, approval and canonical child mapping.

This avoids canonical-copying unrelated prose; it does **not** bypass result/work
accounting. Existing collection traversal checks length, spends per item and returns
all entries. `namedRulesTask` still charges the full emitted result with `footprint`
and shares one finite budget across every result/condition. Existing tests prove
five repeated250×1000-character filter outputs exhaust that budget and a20001-item
collection fails closed. Runtime `stepBindings` already structured-clones every
declared read; these returned entries belong to that Check's owned input scope.
No original producer receipt is mutated, and later reads retain their clone boundary.

No generic evaluator, work/sanitizer/Launch limit, producer share/schema, legacy
alias, approval or permission implementation changes. No requirement/criteria/path/
review-details/canonical text is truncated, summarized or removed. The existing
feedback projection is retained and now tested with three near-share large failed
reviews alongside five complete plans. No extra admissibility restriction is needed.

## Focused production checks

All commands used the explicit implementation workdir. [Logs](media/2026-10-22-improve-blocks/repair-r2-checks/checks/)
are compact copies; only final blank lines are normalized. Original `/tmp/taskbot141-round4-r2-*.log`
files remain untouched.

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/ImproveBoundaryComposition.test.ts -t 'full wrapped Approve|ordinary refinement'
pnpm --filter bobs-factory-edge-worker exec vitest run test/ImproveBoundaryComposition.test.ts test/ImproveRecipe.test.ts -t 'stock approval composition|executes nested research'
pnpm --filter bobs-factory-edge-worker exec vitest run test/Check.test.ts -t 'bounds emitted filter data|shares the total work budget'
pnpm exec tsgo -p packages/edge-worker/tsconfig.json
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --plan-check-fixes
```

- Before correction: **6FAILED/5SKIPPED**, all with the actual operation-limit
  exception. These are retained defect reproductions, not passing tests.
- After the two configuration changes: same selection **6PASSED/5SKIPPED**.
- Final expanded boundary + composed-runtime selection: **13PASSED/1SKIPPED**,
 25.74s. Twelve boundary cases plus one full current composed flow; the unrelated
  edited-fork case was deliberately skipped, not claimed rerun.
- Existing aggregate result/work protections: **2PASSED/30SKIPPED**.
- Necessary owning edge TypeScript emission/typecheck: **exit0**. Focused Biome,
  driver syntax and diff whitespace checks passed. No manual broad build/type/lint
  or native cycle. Normal hook outcomes are separately qualified in the handoff.

The ASCII/UTF8 positive composition cases now actually execute:
Refine parser → stock plan-inputs Check → stock DAG Check → three real format
parsers → stock plan-check → full wrapped stock Approve `viewScope`/`resolveView`.
The inputs include five large complete packages, actual Decide choice output and
five maximum12000-character escaped comments. Both Check outputs must equal the
entire parsed plan collection. Existing aggregate rejection and graph-digest cases
remain in this executed boundary suite.

Four additional large-package cases assert ordinary `passed:false`/Refine behavior
for duplicate ID, unknown ID, omitted accepted prerequisite and mismatched item ID.
They retain the full package output, not a prepared Check result. Another case
parses all three failed reviews with complete7400-character feedback plus an
actionable requirement, then asserts actual later Check failure/feedback/full plans
without a budget exception. No existing assertion, security outcome or deadline
was weakened. The previous tests' prepared `plan-check` output is replaced by the
actual evaluator result, rather than adding a parallel mock route.

The current composed flow remains unchanged in content and original90s deadline:
8 coordinators/14 workers, partial success/concurrency4, targeted Ask without
research replay, cycle→Refine then failed security→Refine/all3 reviews, exact
Approve/Request changes/stale/runtime reconstruction, structured-only requirements,
complete>8000 canonical tasks, two exact human/provider-backed child waves and
immutable accepted mappings/original receipts all pass.

## Current changed F1

The existing driver adds one scoped `--plan-check-fixes` scenario. Actual
EdgeWorker/WorkflowRuntime/catalog/HTTP/CLI use canonical deterministic mock runner
hooks in a fresh disposable repository. An ordinary reachable-closure fork uses
one perspective solely to reach the changed five-plan boundary, then stops at
pending Approve. This is not an eight-perspective/CLI/fork-matrix replay.

Each actual Refine hook returns8000-character prose, a structured-only MUST
criterion plus3900-character criterion, and `src/owner.ts` plus3900-character path.
The five accepted/derived packages are39905 bytes each (the fixture's title is two
characters shorter than the independent39907-byte case; other large fields match).
Both actual stock Check histories occur once and pass, as does the DAG Check.
All three actual review hooks assert they received all five complete packages.
The pending approval's five cards retain every prose/detail value and reconstruct
exactly the canonical task text. No corrections, retries or provider fallback.

Parent `manual-dacf9aa8-cbf2-444e-987c-730b91f70440` stopped during own cleanup;
worker stopped, no browser/server left running, no other service touched. No human
approval submitted, issues filed or children admitted in this scoped drive. Actual
child transfer and dependency proof are covered by the current composed test and
precisely scoped prior stock-child receipts, not invented by this drive.

[Proof](media/2026-10-22-improve-blocks/repair-r2-checks/repair-proof.json),
[source/results](media/2026-10-22-improve-blocks/repair-r2-checks/results.json),
[identity/emitted hashes](media/2026-10-22-improve-blocks/repair-r2-checks/identity.json),
[actual turns](media/2026-10-22-improve-blocks/repair-r2-checks/turns.json),
[HTTP/CLI](media/2026-10-22-improve-blocks/repair-r2-checks/http-cli.json),
[cleanup](media/2026-10-22-improve-blocks/repair-r2-checks/cleanup.json).
Proof retains complete actual approval cards, per-package/canonical hashes and
history counts, avoiding repeated large full-output archives.

Drive ran dirty repair atop a272, not a clean-commit/native drive. All18 selected
runtime source hashes match before/after/current; exact emitted/driver identities
are retained and checked after hooks. Only improvementWorkflow.ts differs from
the prior Round3 drive's18 selected source inputs; its other17 remain exact.
Current changed F1 replaces the Check transport proof. The renderer, view/approval
configuration, canvas nodes/routes, CLI routing, native/provider boundaries and
agent prompt/reads are unchanged, so their exact prior scoped evidence is reused.
No new UI behavior changed or screenshot matrix was rerun.

## Complete criteria for NEW review

Rows report implementation evidence, not independent clearance.

|141 requirement|Disposition/evidence|
|---|---|
|Honest generic stock graph/canvas|Same Snapshot/Call/For each/Check/humans/actions; only ordinary collection expressions change, no runtime/ID privilege. Prior actual canvas reused.|
|Snapshot WITH history → one read-only Map|Pinned whole-scope/history/context bindings untouched; current composed exact revision checks and current actual prepared roles. Clarification2361 supports only the previous unused Approve read removal.|
|Original8 perspectives/filter/output substance|Unchanged byte-identical source/library; current composed8/14 roles; original actual research reused.|
|Concurrency4/keep-successful/coordinator≤2/nested workers/verifier|Current composed bounds/partial cases; unchanged role definitions and original actual prepared research evidence.|
|Consolidate0–5/stable IDs/prior revisions/answers/decisions|Current aggregate rejection/full wrapped ASCII+UTF8 suite and current actual five-item shortlist; prior correction receipts reused.|
|Decide Fix/File/Skip/Ask|Actual choice output/full scope tested; current F1 five Fix; current composed Ask, prior actual mixed filing/Skip evidence.|
|Dedicated Ask→Consolidate without research replay|Current composed counts/history/original receipts; original actual F1 reused.|
|Refine complete packages/IDs/prereqs|Current actual five producers→coverage,4 malformed coverage cases→false/refinement; self/duplicate indexed producer checks unchanged.|
|Complete DAG Check before reviews→Refine|Current composed cycle feedback/correction and all3 reviews; current F1 actual graph Check; Launch final guard unchanged.|
|3 independent parallel reviews/failing check→Refine|Current composed security rejection/correction;3 current F1 actual role invocations with five full plans; upper-feedback actual Check case.|
|Both complete plan handoffs under actual Check work|Current parser/evaluator/real-runtime proofs replace prepared Check outputs; full values retained; existing result/work budget guards executed.|
|Exact Approve/Request changes/displayed graph digest|Current full scope and graph-only source/final digest test; current composed stale/request/reconstruction/exact receipt; unchanged actual UI evidence reused.|
|Parallel File issues/Factory launch/dependency order/wait=true|Current composed filing/two exact human+provider-backed waves; prior actual confirmed backlog/unassigned issue/stock child. New scoped drive deliberately stops preapproval.|
|Complete canonical task in actual children|Current composed structured-only criteria/paths and>8000 task equality across both waves/immutable accepted mapping; prior authenticated stock child input/launchInputs reused.|
|Optional inherited worker model/limitation|Unchanged accepted-model source, current prepared worker hook assertions and prior visible limitation proof; no forced model/fallback.|
|Manual default/editable triggers/Area of focus|Ordinary unchanged declarations/catalog/UI; current manual fork.|
|4 standalone callable subrecipes/palette|Unchanged workflow/manual declarations/palette; original actual closure/fork proof reused.|
|Every bundled closure forkable exceptSimple|Unchanged catalog/UI and current actual closure fork; Factory/Takeover remain otherwise intact pending142.|
|Edited perspective+prompt+renamed role launch|Exact unchanged dedicated test and original CLI/HTTP/provider receipts reused, not rerun this round.|
|Full mocked acceptance sequence|Current composed flow plus current changed actual F1; no overall clearance pending NEW independent review.|
|No hidden improvement runtime authority|Original deleted executor/settings/state/triggers/endpoints/screen remain absent; unchanged classified34 legitimate source references; no new special case.|
|Desktop390 light/dark +360/keyboard|Unchanged current graph/Decide/Details/canvas images/receipts reused with precise prior scope; no UI implementation change or new browser assertion claimed.|
|F1 applicability/report|Applicable and scoped current actual drive passed, with mocks/preapproval/identity limits above.|
|Full suite|**DEFERRED**, current user override, not passed.|

|Required deletion/compatibility/docs|Disposition|
|---|---|
|ImprovementRuntime/orchestration/settings|Deleted outright/no migration; no executed old Improve run.|
|Workflow improvement field/settings schema|Deleted; accepted non-Improve definitions retained.|
|supportsTrigger/legacyTriggers + forced worker preflight|Special cases deleted; ordinary launch/native access preserved.|
|Improve-only Gemini branch|Generic actual unsupported read-only rejection/no silent substitution retained.|
|improvementState/improvementParent|Deleted; generic action/child ownership/history retained.|
|FactoryServer/WorkflowRuntime endpoints/hooks/waiters|Deleted; current repair has no generic runtime edit.|
|Dedicated screen/app/focus/client/child/CSS|Deleted/replaced by generic views; original evidence preserved.|
|Obsolete tests and changed tests|Executor tests deliberately replaced; this round replaces prepared Check outputs with actual evaluations/adds consequential coverage. No security/outcome/deadline weakening.|
|Generic Snapshot/fanout/issue/native/human/provider guards|Unchanged implementations/accepted identities/uncertain receipts; current composed original receipts and dependency gates.|
|R1/R3/R4 + all former R2 bounds|Current complete transfer/aggregate/digest tests and unchanged exact selected-rule/view/parser sources; prior explicit field/selector/native evidence scoped, no inherited overall verdict.|
|Capability/full role prompts|No capability, prompt or agent read change this round. Entire capability expectation and639-entry role fixture remain byte-identical to a272; prior7 passes and579 retained base-entry authentication reused.|
|CHANGELOG/docs/PR link/F1|Existing141 entry updated with complete plan-batch behavior, actualPR178 link retained; maintained Improve doc explains bounded transport; this report and current receipts.|

Epic decisions1–8 remain explicit: **1** all bundled closures exceptSimple fork;
**2** generic configured agents/Check/control/humans/actions; **3** library/custom
schemas unchanged; **4** bounded inert declarative views; **5** targeted Ask/no
survey replay; **6** outright Improve deletion/no migration; **7** optional inherited
worker model; **8** base is merged140/no142+ scope. Epic DoD: one latest-main PR;
focused current consequence/F1 evidence and exact unchanged reuse; full prompt/
changelog/docs; frozen non-Improve/native/human/provider compatibility. NEW exact-head
Standards/Spec review, statuses and guarded `[skip ci]` squash remain parent-owned.
All CI/full-suite/broad/native/integrated post148 cleanup clauses are **DEFERRED**,
except separately recorded actual normal hook executions.

## Limits and retained history

The inherited64k text fallback explicitly notices omission/requires complete
dashboard review. Literal FULL text remains historically PARTIAL under2320/2360;
no pagination, hidden scope digest hashing or consumer-limit widening. Complete
authoritative plans/Details/graph/checks/canonical child task/digest remain.

[Round3 packet](2026-10-22-improve-blocks-round3.md),
[R2/R3 packet](2026-10-22-improve-blocks-r2-r3.md),
[R1/R2 packet](2026-10-22-improve-blocks-r1-r2.md) and
[original packet](2026-10-22-improve-blocks.md) retain original commands, UI,
raw failures, prompts, role/history/CLI/native permission preparation and scoped
source deltas. Their older source inputs are not represented as current execution.
Earlier maxima/locator/setup failures remain failures, not relabelled green tests.

Mocks prove actual prepared restrictions/orchestration, not paid inference or
native enforcement. Runtime reconstruction is narrower than process-crash/native
session recovery. Current F1 stops before approval; current controlled runtime
supplies exact human/provider prerequisite proof separately. No live tracker/
provider/forge/device, credential/native-history inspection, dependency/global
policy/protection change, production/active-run edit, release/deploy or142+ work.

**DEFERRED:** every CI query/trigger/watch/poll/retry/finalization, repeated broad
suite/build/type/lint/packages/apps/scripts/audit/native/binary cycle and consolidated
post148 cleanup. Historical a272 remains NOT CLEAN. New independent acceptance is
required; this packet grants no approval/status/merge authority.
