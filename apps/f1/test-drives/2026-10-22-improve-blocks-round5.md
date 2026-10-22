# #141 Round5: coordinator assignment correction

PR [178](https://github.com/jappyjan/bobs-factory/pull/178), Taskbot [141](https://taskbot.apps.janjaap.de/p/bobs-factory/t/141).
Implementation evidence for **NEW independent review**, not acceptance.
Authoritative2369 found one residual Spec R2/P2 on902a9d3019cfaa4477192deeeec322f17a398a95 /
tree7e87039ef1065bbacc837530441ec77cad66a1dd. Both prior plan Check handoffs were
independently repaired; R1/R3/R4 supported within that report's limits. All prior
candidates remain historically NOT CLEAN. Full141/135, reports2306/2321/2344/2360/
2369, scope2320 and clarification2361 remain review context.

Actual workdir `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`, branch
`taskbot/141-improve`; coordinator/T3 binding unchanged. Node24.21.0/pnpm10.33.1.
Base92cdb8227468a596686fc7cdcc1ef06a0894c4af / treeb808a78f4e95f463b0285808141c5eb929e022d2.
Final HEAD/tree and normal hook outcomes are in the PR/ticket handoff.

## Functional correction

The coordinator schema bounded individual fields and assignment count but accepted
an entire assignment array larger than the receiving nested For each snapshot.
The later exception occurred after producer correction was unavailable, losing a
perspective under keep-successful. At902a: ResearchFormats.ts:78–89,
OutputFormats.ts:98, stock assignments step:87–110, Foreach.ts:295.

Only the new `research-plan-v1` parser now validates its **complete parsed assignments
array** through the same existing public JSON sanitizer before returning the full
plan. A failure keeps the raw original and `/assignments` diagnostic in ordinary
OutputValidationError. This covers actual character/UTF8/node/depth budgets; schema
count/ID/scope limits remain. No trimming, new global framework or generic limit
change. Legacy `improvement-research-plan-v1` remains pure schema parsing, including
its former acceptance. The coordinator prompt explains correction-time collection
limits while preserving required scope and the original prompt substance.

Actual receiving-path audit: this array is consumed by prepareForeach. Map context,
worker results, verifier results and targeted follow-up outputs travel through
existing owned immutable inputs and paged factory-context snapshots; they are not
fed into this bounded item-array snapshot. No further concrete failure was found;
no speculative whole-context restriction or #144 context redesign is added.
Read-only/provider restrictions, pinned history/context, optional model inheritance,
For each concurrency/partial success, plan/DAG/human/provider/Launch guards and
legacy/frozen contracts are untouched.

## Small changed-behavior checks

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/ResearchAssignmentBoundary.test.ts
pnpm --filter bobs-factory-edge-worker exec vitest run test/ResearchAssignmentBoundary.test.ts test/FactoryRolePrompts.test.ts
pnpm exec tsgo -p packages/edge-worker/tsconfig.json
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --research-assignment-fixes
```

- Before fix: **2FAILED/3PASSED**, showing acceptance followed by the actual
  complexity/1MiB receiver errors. Initial scopes had an index suffix within24000
  characters; final regression uses24000 repeated ASCII/Chinese characters exactly.
  Legacy parsing → actual prepareForeach still confirms both former failures.
- Corrected focused boundary: **5PASSED**. Two actual producer rejections retain
  original output/path; ASCII2×20×24000 and UTF82×7×24000 near-boundary collections
  retain both complete unique assignments in actual prepareForeach. Empty skip remains valid.
- Final focused boundary/full role-prompt assertion: **7PASSED**. The639-entry
  complete fixture changes only4 coordinator base/runtime entries;635 unchanged
  versus902a and all579 common protected base entries unchanged. Generator execution
  is separate from these complete assertions; no partial prompt assertion used.
- Necessary owning edge TypeScript compile, focused Biome, driver syntax and diff
  whitespace: **exit0**. No unchanged runtime/UI/CLI/native matrix replay.

[Compact logs](media/2026-10-22-improve-blocks/repair-research-assignments/checks/)
normalize EOF blank lines only; original `/tmp/taskbot141-round5-*.log` files remain.
No security/outcome assertion or timeout was weakened. No new setup/F1 failure.

## Actual corrected runtime path

One disposable actual EdgeWorker/WorkflowRuntime/catalog/HTTP/CLI run uses canonical
mock providers and a one-perspective reachable-closure fork. First coordinator output
is1056434 ASCII bytes; second is384350 characters/1152350 UTF8 bytes. Both reach normal
coordinator correction with full raw originals, `/assignments` diagnostics and the
required lifecycle scope intact. No worker is invoked before the corrected response.

The corrected two assignments each retain the required lifecycle scope plus seven
complete24000-character Chinese scope strings:504137 bytes each. Exactly two actual
read-only worker hooks receive the full expected assignments; the independent
verifier receives the complete coordination and two successful worker results.
Counts:1Map/3coordinator turns/2workers/1verifier/1Consolidate. The perspective
succeeds and reaches actual Decide. No map/research replay or forced worker model.
No human answer, issues, children or delivery effect. Parent
`manual-8d973b9f-331e-4c0f-8e41-ca29c614fec6` and owned worker are stopped.

[Proof](media/2026-10-22-improve-blocks/repair-research-assignments/repair-proof.json),
[source/results](media/2026-10-22-improve-blocks/repair-research-assignments/results.json),
[identity/emitted hashes](media/2026-10-22-improve-blocks/repair-research-assignments/identity.json),
[actual turns](media/2026-10-22-improve-blocks/repair-research-assignments/turns.json),
[cleanup](media/2026-10-22-improve-blocks/repair-research-assignments/cleanup.json).
Full rejected originals remain in the own disposable directory named in proof;
published receipts contain hashes/counts/diagnostics and required scope, not a large
scope archive. Drive ran dirty repair atop902a, not a clean-commit/native drive.
All18 selected runtime sources match before/after/current; exact emitted/driver
hashes are retained and checked after normal hooks. OutputFormats.ts and the
coordinator prompt differ from the prior drive; the other16 selected sources match.

## Current complete criteria disposition

Detailed unchanged rows and exact prior proof are retained in the
[complete Round4 matrix](2026-10-22-improve-blocks-round4.md), with authoritative2369
qualifications. This table records the current correction and all acceptance groups;
it grants no clearance.

|141/Epic requirement|Current disposition/evidence|
|---|---|
|Honest ordinary graph/canvas; no hidden authority|Same generic blocks/routes/runtime; library producer validation only. Existing actual canvas evidence reused.|
|Snapshot WITH history/whole scope→read-only Map|Pinned bindings/provenance untouched; actual current prepared role restrictions and unchanged exact revision proof.|
|8 original perspectives/filter/output substance|Unchanged library/perspectives; current one-perspective scope validates only changed handoff, original8-perspective proof reused.|
|Coordinator≤2→nested workers→verifier; concurrency4/keep-successful|Current actual correction→2 complete workers→verifier succeeds, unit near boundaries/skip; original outer bounds/partial-success proof unchanged.|
|Consolidate0–5/stable IDs/Decide actions/targeted Ask→reconsolidate|Current actual Consolidate/Decide reached; unchanged stable-ID/Ask/no-replay/Fix/File/Skip proof carried.|
|Refine/exact IDs/prereqs/two Check handoffs/DAG/3 independent reviews→correction|Unchanged bounded collection expressions/parsers/guards; prior current upper/invalid/feedback proofs retained, no replay.|
|Exact Approve/request changes/full graph display/source/final digest|Unchanged view/human/rule implementations and canonical content; prior actual digest/stale/restart/currentness proof retained.|
|Parallel File issues/Factory wait/dependency order/full canonical child|Unchanged actions/mapping/accepted IDs/uncertain receipts; prior current two human+provider-backed waves/stock-child equality reused. New drive stops at Decide.|
|Optional inherited model/manual focus/editable triggers|Current worker hook inheritance asserted without worker setting; declarations/launcher unchanged.|
|4 callable workflow/manual subrecipes/palette; all bundled forks exceptSimple|Current actual closure fork; unchanged catalog/UI/edited-prompt+perspective/renamed-role/CLI evidence. Factory/Takeover otherwise unchanged.|
|Old Improve executor/settings/schema/triggers/preflight/state/endpoints/hooks/screen/CSS deleted|All original deletion/inventory/test-replacement rows unchanged; no migration; shared native/read-only/provider/ownership guards retained.|
|Frozen non-Improve definitions/native identities/history/receipts|No migration or active-run edits; raw legacy alias unchanged; generic interpreter/limits untouched.|
|Desktop390/lightdark/360/keyboard and F1|UI unchanged/exact prior renderer/view/canvas evidence reused. Current small mocked F1 above; no new browser/native claim.|
|Capability/complete prompts/changelog/docs|Capability/entire expected prompt unchanged;4 complete coordinator prompt entries intentionally changed; actualPR178 changelog and functional doc updated.|
|Full E2E/restart/retry/idempotency/concurrency/stale|Current coordinator retry path plus precise unchanged composed/actual receipts; no overall acceptance inherited.|
|Epic decisions1–8|Universal forks exceptSimple; generic blocks; library/custom formats; inert views; targeted Ask; outright deletion; inherited model; base merged140/no142+ all retained.|
|PR/review/delivery DoD|One latest-main PR; NEW parent-owned exact-head Standards/Spec review/status/guarded[skip ci] squash required. User's functional/logical/performance threshold applies.|
|Full-suite/CI/broad/native/integrated cleanup|**DEFERRED** by current user policy until post148, not passed; actual normal hooks separately recorded in handoff.|

Inherited64k fallback remains explicitly incomplete/dashboard-required; literal FULL
text historically PARTIAL under2320/2369. No pagination/limit widening. Mocks prove
prepared restrictions/orchestration, not native enforcement/paid inference/process
crash recovery. Unchanged approval/child/provider evidence has its original scoped
limits. Earlier negative/maxima/setup/locator failures stay historical failures.
No deps/global workflow/protection/production/active-run/release/142+ effects.
No CI query/trigger/watch/poll/retry/finalization or broad repeated build/type/lint/
packages/apps/scripts/audit/native cycle. Cosmetic cleanup and optional hardening
remain deferred under the latest user threshold.
