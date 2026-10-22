# #141 combined residual R2 / R3 repair packet

PR [178](https://github.com/jappyjan/bobs-factory/pull/178), Taskbot [141](https://taskbot.apps.janjaap.de/p/bobs-factory/t/141).
This is implementation evidence for a **new independent review**, not acceptance.
Authoritative Round2 report2321 found residual R2 and new R3, both P2, on immutable
9621f6ab7babf3c573853ef8abf1dbdf53de1ad7/tree cda091f2ebf8f4568660b05a32759329cb408d0b.
That candidate and4754 remain historically **NOT CLEAN**. Report2321 independently
cleared R1 and the original R2 limitation/prose cases within its stated limits.
All earlier reports, failed probes, images and original receipts remain retained.

Actual execution: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`,
branch `taskbot/141-improve`; T3 coordinator binding was not changed. Remote main
was checked through Git identity metadata only and remains
92cdb8227468a596686fc7cdcc1ef06a0894c4af/tree b808a78f4e95f463b0285808141c5eb929e022d2.
Node24.21.0/pnpm10.33.1. Final published HEAD/tree are in the PR and live ticket
handoff; the drive ran the uncommitted repair over9621 with exact source hashes.

## Root causes and corrections

**R2:** Consolidate accepted300-character card titles, but File issues accepts250.
The producer now pipes through the same exported generic filing title/body schemas
as the action, then the existing view schemas. The action bounds remain250/100000;
no truncation or guard removal. Oversized titles fail at Consolidate with original
output and `/opportunities/<index>/title`, while correction is still available.
Stock action mapping audit: issueBody's24000-character producer cap fits100000;
five items fit both action limits; safe IDs and dependency mapping are unchanged.
Launch prompt/title and complete canonical plan remain nonempty strings accepted
by the generic launch schema. No output-driven labels/destination are introduced.
Raw legacy `improvement-*` data formats keep their previous schemas.

**R3:** valid individual packages could form an invalid complete graph only rejected
after approval. Refine now rejects self/duplicate prerequisites at their exact array
indices. A new ordinary canvas Check projects the selected plans' IDs and dependency
lists, validates `dependency-graph-v1`, and branches back to Refine on failure before
the independent reviews or Approve. Feedback carries the actual rejected parallel
lists; the prompt requires removing invalid edges/cycles while retaining accepted
prerequisites. All three reviews run on the corrected plans. Approve explicitly
reads the graph result, binding it into its content digest alongside plans/reviews.

The library graph schema is pure, bounded, iterative and reusable: equal list
coverage, unique IDs/edges, known targets, no self edges/cycles. The generic
`conforms` rule accepts an optional safe JSON Pointer to choose its argument. Stock
checks only the small graph projection, avoiding quadratic format prepayment over
large approval prose; existing rule budgets, getter/prototype restrictions and
fixed-parser-only behavior remain. No Improve runtime/step-ID authority was added.
LaunchRuns' final fail-closed DAG checks and pending/uncertain receipts are untouched.

## Focused verification and retained failures

Commands/logs are in [checks](media/2026-10-22-improve-blocks/repair-r2-r3/checks/).

- ResearchFormats/Check/changed composed runtime selection: **46passed,1failed,
  3skipped**. The failure was a new test harness scope missing the required
  `outputs` namespace; the actual250-character filing case then passed alone
  (**1passed,24skipped**) after correcting that setup. No product assertion removed.
- The composed runtime case passed in that selection with its original90s deadline.
  Added cycle → graph Check failure → Refine, then retained failed security review
  → Refine → pass. Six plan calls replace four because there is one extra correction
  round. Exact rejected graph/feedback and all six independent review invocations
  are asserted. Existing eight perspectives/14 workers, partial success/concurrency4,
  Ask without replay, request changes, stale answer, runtime reconstruction, exact
  approval, issue filing, structured-only criteria/path, complete packages over8000,
  two dependency waves, explicit human/provider proof and immutable receipts remain.
- Boundary regressions include251/300 title rejection with raw output/path and raw
  legacy compatibility; self/duplicate producer errors; actual stock graph Check
  failures for cycle/self/duplicate/unknown edges; empty and five maximum-size plan
  DAGs passing within unchanged rule budgets; selected-pointer/root-path behavior.
- Complete role prompts + capability prompt + FileIssues suites: **13passed**.
  The639-entry complete fixture changes only eight Consolidate/Refine entries;
  the631 other compact entries and protected historical prompts remain unchanged.
  No partial prompt assertion replaced the full prompt/components/type/verify checks.
- Owning edge TS emission: exit0. A second emission followed the final explicit
  approval graph-read binding; it was a changed-source check, not an unchanged replay.
  Owning web bundle: exit0, necessary because generic Rules is also compiled into
  the Check editor. Focused Biome and diff whitespace checks passed.

Normal commit hooks passed lint-staged, all20-project build and all19 scripted
typechecks. Full hook log: `/tmp/taskbot141-r2-r3-commit-hooks.log`. An evidence-only
amend normalized three published log EOF blank lines (original raw logs retained
in `/tmp/taskbot141-r2-r3-raw`) and added this result; hooks were not replayed.
Product source/tests were unchanged by that amend. No dependency change/audit run.

## Actual changed EdgeWorker/F1 flow

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --dependency-fixes --serve
```

The actual catalog fork keeps one research perspective and uses its ordinary
editable launch target to invoke installed stock Factory. Three stable proposals
choose two Fix and one File issue; the second Fix retains the first as prerequisite.
The real EdgeWorker's read-only Codex provider hooks receive deterministic canonical
F1 mock responses. Consolidate returns title251, receives its retained correction
context, then returns all250 characters. Two Refine outputs deliberately return
self/duplicate edges, receive exact indexed errors, then form a cross-package cycle.
The actual graph Check fails and passes its exact graph to the next two Refine calls.
After correction, architecture/security/dependency agents each run once.

Before exact human HTTP approval there are zero issues/children. After approval,
one confirmed mocked backlog/unassigned issue retains the complete250-character
title. Accepted launch items retain both stable IDs, prerequisite edge and full
canonical reviewed text. The actual stock Factory child receives identical `input`
and `launchInputs`, has its own worktree, waits at clarification with zero child
human decisions. The dependent child is **not admitted** without exact human/provider
merge proof. That proof is supplied only in the separate controlled runtime case.

[Proof](media/2026-10-22-improve-blocks/repair-r2-r3/repair-proof.json),
[provider turns](media/2026-10-22-improve-blocks/repair-r2-r3/turns.json),
[results](media/2026-10-22-improve-blocks/repair-r2-r3/results.json),
[HTTP/CLI](media/2026-10-22-improve-blocks/repair-r2-r3/http-cli.json),
[cleanup](media/2026-10-22-improve-blocks/repair-r2-r3/cleanup.json).
All18 selected runtime source hashes matched before/after and current source before
commit. Accepted definition bodies are represented by exact JSON hashes rather
than recursive duplicated catalog archives; accepted items/content remain complete.

First drive reached genuine Approve, then a new harness deepStrictEqual compared a
null-prototype JSON result to a normal object. Retained under
[attempt1-null-prototype](media/2026-10-22-improve-blocks/repair-r2-r3/attempt1-null-prototype/).
The corrected assertion compares **all exact serialized JSON values**, retaining
the original raw result. No guard/outcome/deadline was weakened. The successful
drive's collector was later extended only with a canvas-only mode; execution and
assertions were not replayed. Both owned workflow runs and server were stopped.

## Current UI and unchanged evidence reuse

An initial browser request hit an already stopped fixture, then the RPC port's404;
these are setup errors. The workflow server's retained old web bundle also displayed
an invalid Check configuration for the new pointer field. The owning web rebuild
and a fresh idle **actual EdgeWorker** preview resolved that stale-build setup.
No UI source/HTML/CSS was injected, no other server was stopped, no workflow replay.

```sh
node packages/edge-worker/scripts/build-factory-web.mjs
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --canvas-only --serve
```

[Four actual canvas captures/receipts](media/2026-10-22-improve-blocks/repair-r2-r3/ui/receipts.json)
show the **built-in stock graph**'s selected dependency Check and real correction
route at1440×1000/390×844 light/dark. The Check panel shows the exact projection and
pointer rule without invalid/unsaved state. At360px scrollWidth=360; close panel →
focus actual node → Enter restores `step=plan-dependencies` and the correct panel.
Theme was selected through the existing saved browser preference and reload.
Fresh preview has zero workflow runs and is stopped; its owned tab is closed.

Unchanged Decide/Approve desktop390 light/dark, Details/360/keyboard evidence is
reused from the [R1/R2 report](2026-10-22-improve-blocks-r1-r2.md). Original eight-
perspective/CLI/fork/native permission preparation evidence remains in the
[original report](2026-10-22-improve-blocks.md). These are authenticated scoped
behavior proofs, not inherited overall clearance. Current runtime execution covers
the changed graph and retained complete child transfer; old UI component bytes are
unchanged. New prompt/schema hashes intentionally differ from earlier drives.

## Complete criterion dispositions for the new review

Each row describes implementation evidence; parent owns independent verdicts.

|141 criterion|Current evidence/disposition|
|---|---|
|Honest generic stock canvas/runtime|Current explicit dependency Check capture; Snapshot/Call/For each/Check/humans/actions, no hidden interpreter.|
|Snapshot/history + single read-only Map|Current composed execution; unchanged actual EdgeWorker hooks/pinned scope preparation.|
|Original8 perspectives/filter/output substance|Current composed8/14 roles; unchanged prompt substance/source inventories from prior independent review.|
|Concurrency4, keep-successful, ≤2 assignments/nested workers/verifier|Current composed partial-success/peak assertions; prior exact F1 research reused.|
|Consolidate0–5/stable IDs/revisions|Current boundaries; actual title correction/stable IDs; retained prior-answer reconsolidation.|
|Decide Fix/File/Skip/Ask|Current composed Ask/decisions; current F1 Fix/File; unchanged Skip/view proofs reused.|
|Dedicated Ask→Consolidate without research replay|Current composed invocation/history assertions; original actual F1 reused.|
|Refine/dependencies +3 independent checks|Current producer self/duplicate correction, full cycle Check/refine; current runtime review failure/refine and F1 three reviewers.|
|Exact digest-bound Approve/Request changes|Current composed stale/restart/request-changes/original receipt assertions; current F1 exact approval. Graph result explicitly digest-bound.|
|Parallel filing/Factory launch/dependency order/wait=true|Current F1 full250 title + child blocked prerequisite; current controlled two-wave human/provider proof.|
|Full reviewed criteria/paths/canonical task retained|Current composed packages>8000 and exact two-wave inputs; current actual stock child canonical task equality.|
|Optional worker model/inheritance limitation|Current runtime/F1 accepted run model and prepared permissions; unchanged visible limitation proof reused.|
|Manual default/editable triggers/Area of focus|Unchanged normal schema/catalog; original actual CLI/UI receipts reused.|
|4 standalone callable subrecipes/palette|Unchanged workflow/manual declarations and palette; current stock canvas exposes normal blocks.|
|Every bundled reachable closure except Simple|Unchanged fork catalog/UI; current F1 real closure fork; prior edited perspective/prompt/renamed role execution reused.|
|End-to-end acceptance steps|Changed current composed flow + scoped actual F1, with explicit controlled/mock limits. New independent review still required.|
|Delete old Improve/runtime/settings/schema/triggers/preflight/state/endpoints/hooks/screen/CSS|All remain deleted; no deletion/compatibility changes in this repair. Original complete inventory retained.|
|Gemini/read-only/shared adapters/native stores|Unchanged generic actual read-only checks/adapters; no fallback or credentials/history migration.|
|No hidden improvement authority|Prior34-match classified inventory unchanged; new module/condition generic, stock bindings explicit.|
|Screenshots desktop390 light/dark +360/keyboard|4 current stock Check captures/actual metrics;8 unchanged Decide/Approve captures reused.|
|Capability/changelog/full prompts/F1 docs|Updated capability+entire expected prompt, role fixture, docs/changelog and this report.|
|Frozen non-Improve accepted definitions/forks/receipts|Legacy formats unchanged; new path optional; current original receipt/reconstruction proof. No active-run edits.|
|Full suite clause|**DEFERRED** under latest user/epic policy, not passed.|

Epic decisions1–8 remain: universal bundled forks except Simple; generic configured
agents/control/humans/actions; library/custom formats; declarative inert views;
targeted Ask/no replay; outright old Improve deletion; optional inherited worker;
foundation-first base140 with no142+ work. This repair changes only library/Check/
producer composition and its explicit stock graph.

Epic DoD: one latest-main PR/ticket link retained; new exact-head Standards/Spec
review remains parent-owned; no acceptance/status/merge here. Focused consequential
tests and relevant mocked F1/UI are above. Original evidence/native identities and
frozen definitions remain immutable. Final integrated cleanup is after148.

## Limits and deferrals

Complete authoritative dashboard Details, canonical child tasks and exact digest
are retained. Per live2320/report2321, the inherited64k text fallback explicitly
notices omitted content and requires complete dashboard review before acceptance.
Literal FULL text was historically **PARTIAL**; this packet does **not** claim all
maximum-size content fits that fallback. No pagination/renderer-limit widening.

Mocks establish actual prepared provider restrictions and correction flow, not
native enforcement, paid model behavior or native/process-crash recovery. Runtime
reconstruction is narrower than a process crash. F1 stops stock children before
implementation/delivery; controlled runtime supplies exact prerequisite proof.
No live provider/tracker/forge/device effects, dependency change, production,
active run, release/deployment, global settings/protection or142+ work.

**DEFERRED:** CI queries/triggers/watch/poll/retries, broad full suites/build/types/
lint/package/app/script/audit/native cycles; normal hooks are separately qualified.
Use `[skip ci]` on published commits; parent owns guarded squash/new acceptance.
