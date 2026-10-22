# #141 combined Round3 R2/R3/R4 repair packet

PR [178](https://github.com/jappyjan/bobs-factory/pull/178), Taskbot [141](https://taskbot.apps.janjaap.de/p/bobs-factory/t/141).
Implementation evidence for **NEW independent acceptance**, not clearance.
Authoritative report2344 found three P2s on immutable118bcf7b10d037a331579c99cdc9ffcf449de795 /
tree7dcfcb768256a622a2205ca266afbd0db71f56f1: residual aggregate R2, displayed-result
R3, new unavailable-selector R4. That candidate and4754/9621 remain historically
**NOT CLEAN**. R1 was independently supported within report2344's stated limits.
Original reports, review probes, failures, receipts and images remain unchanged.

Execution: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`,
branch `taskbot/141-improve`; coordinator T3 binding untouched. Node24.21.0 /
pnpm10.33.1. Latest remote main checked through Git identity metadata only:
92cdb8227468a596686fc7cdcc1ef06a0894c4af / tree b808a78f4e95f463b0285808141c5eb929e022d2.
Final published HEAD/tree are in the PR and ticket handoff. Drive ran dirty repair
over118b; all18 selected runtime source SHA256 values match the executed bytes.

## Corrections and boundaries

**R2:** individual field limits did not constrain complete accepted/derived JSON.
The format library now uses the **actual unchanged public JSON sanitizer** after
derivation. Proposals reserve1/8, each plan1/16 and each review1/64 of its character,
UTF-8 byte, node and depth budgets. Validation repeats the complete value in a
bounded envelope; it never truncates or returns the copies. This includes duplicated
limitations, complete canonical task text, plan details and joined review display.
Failures reach normal producer correction with raw original output, root path and
an explicit receiving-budget diagnostic. Legacy data-only aliases are unchanged.

These conservative shares account for two proposal contributions (direct plus
decision items), five plans, three reviews, graph/wrapper overhead and five12000-
character choice comments, including JSON escapes/multibyte data. The production
composition regression executes parse → stock `viewScope`/Decide → actual
`viewAnswerOutput` → **full wrapped stock Approve scope**, with complete accepted
data, five large canonical packages and maximum-length control-character comments.
Both ASCII and UTF-8 cases pass; required criteria/paths remain intact.

Only the stock Approve's **unused/nondisplayed raw `baseline: snapshot` read** is
removed. It never entered the resolved view or its digest and could independently
copy large history into that scope. No data that was displayed is removed. Required
baseline stays in canonical reviewed plans; Snapshot receipt/history, Map, research,
worker/verifier, Refine and all three reviewers retain their original pinned context
bindings and authority. Generic view scope/digest/For each limits are unchanged.

**R3:** a read declaration retained graph data privately but did not bind its value
into display/digest. Stock Approve now binds the complete actual graph result into
an existing bounded Markdown component. A generic path binding's `format: "json"`
serializes already-sanitized public JSON as inert text; existing text limits still
validate the result. No renderer, global digest semantics, hidden scope hashing or
Improve runtime special case. Actual production `viewScope`, `resolveView`, source
digest and `viewRecordDigest` regression changes only graph.passed with fixed
identities: display, source digest and final digest now all differ. This presentation
probe does **not** claim that an invalid graph may pass the earlier gate.

**R4:** the new selector used ordinary projection, which let missing direct data
become undefined and missing wildcard sources become empty arrays. Permissive
production `json-v1` then returned true. Selector-only traversal now requires actual
sources, including every partial wildcard item, and preflights selected JSON before
the fixed parser. Missing/non-JSON values fail; descriptor/prototype/cycle errors
and finite work prepayment stay fail-closed. Explicit null, escaped/root pointers,
existing empty collections, false/zero and historical no-selector behavior remain.
There is no global JSON parser change or separate legacy sparse/undefined migration.

## Focused checks and honest failures

[Logs](media/2026-10-22-improve-blocks/repair-r2-r3-r4/checks/) retain results.
Final selections cover `Check.test.ts`/format prepayment in `RulesBudget.test.ts`,
`ImproveBoundaryComposition.test.ts`, `ResearchFormats.test.ts`, the
`executes nested research` case in `ImproveRecipe.test.ts`, changed JSON bindings
in `View.test.ts`, `FactoryRolePrompts.test.ts` and the complete routing-context
prompt suite. Necessary owning build commands were
`pnpm exec tsgo -p packages/edge-worker/tsconfig.json` and
`node packages/edge-worker/scripts/build-factory-web.mjs`.

- R4 pre-repair production-library conformance selection: **9failed/1passed/22skipped**.
  This reproduced direct/wildcard/partial and invalid selected-value passes, with
  legitimate controls. Replaced the masking stub with actual production `conforms`.
- Corrected Check + relevant format-prepayment budget selection: **33passed/10skipped**.
  Actual library callback, no-validator behavior, null/root/escaped/empty/no-selector
  compatibility and selected-data safety remain covered. No format-name exception.
- Pre-repair R2/R3 production composition: **3failed** (two aggregate cases and
  unchanged displayed/source/final digests), retained before corrective code.
- Initial combined boundary/view run: **127passed/1failed**. The former positive
  fixture combined every field maximum beyond the new aggregate share. It was
  revised to exercise field maxima within an admissible complete payload, retaining
  five items/30 limitations; separate aggregate rejection cases were added. No
  consumer limit, security/outcome assertion or deadline was weakened.
- Corrected composition/changed view selection: **8passed/124skipped**. Then the
  final runtime/format selection: **33passed/1skipped**, including all25 format cases,
  seven full production composition/budget cases and the consequential composed flow.
  The latter retains cycle→Refine, failed security→Refine,8 coordinators/14 workers,
  partial/concurrency4, Ask without replay, Request changes/stale/reconstruction,
  exact approval, structured-only criteria/paths, complete>8000 canonical tasks,
  two explicit human/provider-backed waves and original immutable receipts.
- Full capability and complete role prompts: **7passed**. Current639-entry fixture:
  20 entries intentionally change for Consolidate, Refine and three reviewers' budget
  instructions;619 compact entries unchanged versus118b. All579 retained original
  compact entries match base;96 retired old Improve entries are intentionally absent.
  Shared capability text is deliberately updated and its entire expected prompt /
  components/type/verify assertion remains. No partial prompt assertion substituted.
- Owning edge TypeScript emission and web bundle: **exit0**. Web build
  `b53d0a4a4092fe41d72990ca` supplies the actual UI evidence. Syntax, focused Biome
  and diff whitespace checks passed. Normal hook outcomes are separately recorded
  in the final handoff; no manual broad replay or dependency audit.

Published log copies normalize final blank lines only; untouched raw copies remain
at `/tmp/taskbot141-round3-raw-logs/`. No result or failure text was removed.

## Actual changed EdgeWorker/F1 and UI

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --round3-fixes --serve
```

Real EdgeWorker/WorkflowRuntime/catalog/HTTP/CLI with canonical deterministic F1
mock handlers and a fresh local Git repository. An actual closure fork uses one
perspective and ordinary editable stock Factory launch target. First Consolidate
output:603627 JSON characters/603645 UTF-8 bytes; second:483612 characters/1443630
bytes. Both reach normal correction with original output and aggregate diagnostics.
Corrected output preserves required criteria/paths/non-goals and complete20000-
character Chinese evidence. This passes real Decide and combined Approve reads.

Current Approve displays the actual graph. At360px, scrollWidth=360 and Approve is
disabled before acknowledgement; focusing the real checkbox and Space checks it
and enables Approve. The controlled browser then explicitly submits exact approval.
One confirmed mocked backlog/unassigned issue is filed; a normal stock Factory child
gets identical full canonical `input` and `launchInputs`, its own worktree and zero
child human decisions, waiting at clarification. Ordinary downstream human/provider
gates remain; no provider merge/completion is fabricated.

Three additional actual EdgeWorker Check runs use **production json-v1**: missing
direct and wildcard selections both yield `{passed:false,valid:false}` and the
configured missing-data route; a present control yields true/present route. All
complete without any provider role invoked by the Checks.

[Proof](media/2026-10-22-improve-blocks/repair-r2-r3-r4/repair-proof.json),
[results/source hashes](media/2026-10-22-improve-blocks/repair-r2-r3-r4/results.json),
[actual provider turns](media/2026-10-22-improve-blocks/repair-r2-r3-r4/turns.json),
[HTTP/CLI](media/2026-10-22-improve-blocks/repair-r2-r3-r4/http-cli.json),
[cleanup](media/2026-10-22-improve-blocks/repair-r2-r3-r4/cleanup.json).
Full rejected outputs remain immutable in the own disposable directory's
`rejected-originals.json`; published proof retains exact hashes/bytes/counts,
essential requirements and diagnostics without a giant payload archive. Accepted
tasks/approval/child values remain complete; definitions have exact JSON hashes.
All18 selected runtime hashes match before/after/current source. Collector source
did not change after this drive. Parent/child stopped, three selector runs completed,
worker stopped, owned browser tab closed; no other service touched.

[Four actual changed approval captures/receipts](media/2026-10-22-improve-blocks/repair-r2-r3-r4/ui/receipts.json):
1440×1000/390×844, light/dark. Mobile shows pending approval; desktop shows the same
accepted immutable content read-only. Every retained image visibly includes the
actual graph value. No HTML/CSS injection. Optional unchanged Details expansion
attempts returned `Preview automation click received an invalid locator (27 characters).`
They were abandoned; old expanded Details captures/keyboard checks are reused.
Current360/Space/approval guard behavior above was actually exercised, not reused.

Unchanged stock canvas/DAG route evidence is reused from the
[Round2 repair packet](2026-10-22-improve-blocks-r2-r3.md); unchanged Decide/expanded
Details images from [R1/R2](2026-10-22-improve-blocks-r1-r2.md); original eight-
perspective/CLI/edited-fork/native permission preparation from the
[original packet](2026-10-22-improve-blocks.md). Their different source inputs are
historical, scoped proofs, not inherited verdicts. New current F1 replaces changed
producer/view/selector portions; canonical transfer is checked again currently.

## Complete criterion dispositions for NEW review

Rows describe implementation evidence, not independent acceptance.

|141 requirement|Disposition/evidence|
|---|---|
|Honest generic graph/runtime/canvas|Explicit stock DAG Check/ordinary blocks retained; current approval binding generic; unchanged actual canvas reused.|
|Snapshot/history + single read-only Map|Pinned whole scope/history bindings untouched; current actual provider hooks/composed proof. Unused Approve read removal does not affect these contexts.|
|Original8 perspectives/filter/output substance|Unchanged perspective/filter/library source; current composed8/14 roles; original actual F1 research reused.|
|Concurrency4/keep-successful/coordinator≤2/nested workers/verifier|Current composed partial/failure/concurrency and bounded source; unchanged original actual research preparation.|
|Consolidate0–5/stable IDs/revisions|Current aggregate correction/ASCII+UTF8/derived budgets; current stable shortlist; retained reconsolidation history/IDs.|
|Decide Fix/File/Skip/Ask|Current wrapped choice-output test/current F1 Fix/File; current composed Ask/no replay; unchanged Skip proof reused.|
|Dedicated targeted Ask→Consolidate|Current composed invocation/history retention, original actual F1 authenticated reuse.|
|Refine/packages/prerequisites/stable identity|Indexed self/duplicate and exact selected coverage retained; aggregate plan budget/complete criteria and paths currently checked.|
|Complete DAG Check→Refine before approval|Current composed correction then3 reviews; prior exact current graph feedback/Launch guard evidence reused unchanged.|
|3 independent reviews/fail-check refinement|Current composed security failure/correction; all3 actual F1 roles. Review JSON budget includes full derived display.|
|Exact Approve/request changes/graph binding|Current actual graph display/source/final digest mutation; current UI exact approval; retained current stale/restart/request-changes/original receipt tests.|
|Parallel filing/Factory launch/dependency order/wait=true|Current actual mock filing/stock child; current controlled two human/provider-backed waves, exact dependencies/immutable accepted mapping.|
|Full canonical reviewed task → children|Current composed structured-only requirements/path and>8000 tasks across2waves; current actual stock child input/launchInputs equality. R1 preserved.|
|Optional inherited worker/no hidden preflight|Unchanged accepted model source; current actual prepared restrictions; prior visible limitation proof reused.|
|Manual default/focus/editable triggers|Unchanged ordinary declarations/catalog/UI; current manual fork and custom selector workflows use normal triggers.|
|4 standalone callable subrecipes/palette|Unchanged manual/workflow declarations and palette; original actual/editable closure proof reused.|
|All bundled closures except Simple forkable|Unchanged catalog/UI permissions; current actual closure fork. Factory/Takeover not decomposed.|
|Edited perspective/prompt/renamed role launch|Previously authenticated exact unchanged fork test/CLI receipts reused; current one-perspective fork operates ordinary copied graph.|
|Complete E2E acceptance sequence|Current composed plus current changed actual F1; no blanket acceptance pending new independent review.|
|Old Improve deletion/state/triggers/endpoints/screen/tests|Remain deleted; no migration. Original complete inventory/test replacement reasons retained. No new special runtime authority.|
|Generic permissions/native/Snapshot/fanout/Check guards|Untouched shared native/read-only/context-only/adapters/ownership; selector fails before actual parser, preserves no-selector compatibility and fixed budgets.|
|No leftover hidden improvement authority|Original classified source inventory unchanged in kind; library formats/recipe labels/docs are legitimate, not ID dispatch.|
|Desktop390 light/dark +360/keyboard|4 current graph approval images/current360 Space/guard/approval; exact unchanged canvas/Decide/Details evidence reused.|
|Capability/full prompts/changelog/docs/F1|Updated complete expectation,20 explicit role entries, shared-library/view docs/changelog and this report.|
|Frozen non-Improve definitions/forks/receipts|Raw legacy schemas/no-selector behavior retained; no saved definition/history/native migration or active-run edit.|
|Full suite|**DEFERRED**, user override; not passed.|

Epic decisions1–8 remain: all bundled forks exceptSimple; generic agents/Check/
control/humans/actions; library/custom schemas; inert bounded declarative views;
targeted Ask/no research replay; outright old Improve deletion; optional inherited
worker model; foundation-first base140/no142+ work. Epic DoD: one linked latest-main
PR, focused consequential/current F1/UI evidence above, full prompt/changelog/docs,
preserved frozen/native identities. NEW exact-head Standards/Spec verdict, status
and guarded `[skip ci]` squash remain parent-owned. Post148 cleanup is deferred.

## Limits

Complete authoritative dashboard/Details/canonical child task/digest are retained.
Inherited64k fallback explicitly notices omissions/requires full dashboard review;
literal FULL-text remains historically **PARTIAL** under2320/2344. No new pagination
or widened renderer/JSON/For each/Check limits. Conservative producer shares reject
some combinations of independently maximal fields while correction is possible;
they do not promise every old per-field maximum can coexist in one accepted output.

Mocks prove actual prepared permissions/orchestration/correction, not native
enforcement, paid inference or process-crash recovery. Runtime reconstruction is
narrower; F1 stock child pauses before implementation/delivery, while controlled
runtime explicitly supplies prerequisite human/provider proof. No live provider/
tracker/forge/device effects, credentials/native-history inspection, dependency,
global workflow/protection, production/active-run, release/deploy or142+ changes.

**DEFERRED:** all CI queries/triggers/watch/poll/retries, full suites and manual
broad build/type/lint/packages/apps/scripts/audit/native cycles; normal hooks are
separately qualified. Source frozen only in the final combined candidate; original
118b remains NOT CLEAN. New parent-owned independent acceptance is required.
