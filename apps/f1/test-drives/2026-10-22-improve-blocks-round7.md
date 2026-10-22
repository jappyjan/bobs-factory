# #141 Round7: honest Retry after missing ownership

Implementation evidence for NEW independent review of [PR178](https://github.com/jappyjan/bobs-factory/pull/178),
[Taskbot141](https://taskbot.apps.janjaap.de/p/bobs-factory/t/141). No acceptance/status/merge claim.
Full authoritative2389 found one residual R5/P2 on463dd29ed4da540e409991f1b933037bacaf09d1 /
tree9fc45c61a7a070a7a08950ebd7e9e611899ee973: ordinary Retry of a genuine saved
ownership failure falsely completed with `parallel:[{}]`. New ordinary completion
and genuine unfinished recovery were independently supported; R1–R4 preserved
within that report's limits. Historical463d and all earlier candidates remain NOT CLEAN.

Actual execution `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`,
branch `taskbot/141-improve`; coordinator/T3 binding unchanged. Node24.21.0/pnpm10.33.1.
Latest Git main/base and final HEAD/tree are recorded in the PR/ticket handoff.
Full141/135, authoritative2306/2321/2344/2360/2369/2379/2389, responses,
scope2320/baseline2361 and current functional/logical/performance threshold remain review context.

## Concrete correction

At463d, `restoreFrameReceipts` installed an empty map before validating historical
containers. An ownership exception left that partial map saved by launch cleanup.
On Retry, the function trusted any present map; `frameResults` omitted its missing
Call and falsely published successful empty output. Original history survived.

Restoration now builds a local map and publishes only after validation succeeds.
Already-present maps are also checked for a missing **finished container** with an
original qualified history receipt. The existing missing-ownership error remains;
no receipt is invented from wrapper JSON, inherited names or visits. An active
current step with an existing map retains its normal completion/publication path;
the original no-map historical-container guard is unchanged. Empty/unvisited
branches do not acquire synthetic ownership. Original frame/iteration matching,
inherited-output exclusion, native/no-replay and legacy aliases remain intact.
No new framework, history migration, schema/limit change or product guard removal.

The failed fixture is the exact genuine old-runtime saved state supplied by the
independent review, not a patched checkpoint. Raw SHA256
`b6c50ec3f0b5667d6daba7c15fa082bc4df756744562fe347a2038a7501171a8`.
All parsed fields equal the supplied saved record, including checkpoint/history/
outputs/attempts/workflows/events. Only formatting changes on the committed JSON.
Owning tests use the unrelocated state. [Provenance](media/2026-10-22-improve-blocks/repair-parallel-retry/provenance.json)
records the source, hashes, local raw logs and precise F1 relocation below.

## Small practical checks

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/ParallelCallOwnership.test.ts -t 'genuine saved ownership failure'
pnpm --filter bobs-factory-edge-worker exec vitest run test/ParallelCallOwnership.test.ts
pnpm --filter bobs-factory-edge-worker exec vitest run test/ForeachOwnership.test.ts -t 'restores an older unfinished ownership|fails closed before approval when an older completed wrapper'
pnpm exec tsgo -p packages/edge-worker/tsconfig.json
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --parallel-retry-fixes
```

- Before repair: **1 failed conformance assertion**,2 skipped; real ordinary Retry
  reports completed instead of failed. No setup failure in this reproduction.
- Final owning file: **4PASS**. Genuine saved failure remains failed across two
  ordinary Retry attempts separated by shutdown/disk reload, with unchanged history
  and branch outputs, no projected Parallel and zero agent calls. New modern+legacy
  completion and genuine unfinished4561 recovery still pass. A current Call paused
  after its accepted result save resumes through normal ownership publication,
  preserving the original history/one Call receipt without replay.
- Two selected existing restoration guards: **2PASS/13SKIP**. Old unfinished direct
  receipts restore without adopting prior skipped authority; completed containers
  lacking provable ownership remain fail closed.
- **Six distinct final product tests pass.** An intermediate3PASS preceded the final
  active-result-boundary test. No assertion/deadline/security outcome was weakened.
- Owning edge TypeScript compile, focused Biome, driver syntax and diff whitespace
  pass. Normal hooks and final exact-byte identity are recorded separately in handoff.
  No unchanged research/plan/UI/native matrix replay.

## Actual EdgeWorker Retry

A disposable actual EdgeWorker loads the genuine saved failure. The first F1 attempt
correctly stops at the real `Saved worktree is unavailable` guard because the old
synthetic workspace had been removed. That assertion failure/cleanup is retained
under [attempt1](media/2026-10-22-improve-blocks/repair-parallel-retry/attempt1-unavailable-workspace/).
The fixture setup was corrected by relocating **only its operational workspace** to
a fresh own Git worktree; checkpoint/history/outputs/attempts/workflow authority
remain the captured values. No product guard was weakened. The unrelocated fixture
remains the exact input for the unit Retry/reload regression.

Two actual HTTP `/api/runs/parallel-call/retry` requests each return202 admission and
then the run honestly settles **failed** with the original missing-container error.
Neither publishes a Parallel result. The full seed/child/Call history and original
branch outputs stay equal; zero Factory role invocations, issues, children, native
or paid calls. Completion is never inferred from the HTTP admission response.
Own worker/server stops; the synthetic run remains truthfully failed.

[Actual proof](media/2026-10-22-improve-blocks/repair-parallel-retry/repair-proof.json),
[HTTP/CLI](media/2026-10-22-improve-blocks/repair-parallel-retry/http-cli.json),
[source/emitted/driver identity](media/2026-10-22-improve-blocks/repair-parallel-retry/identity.json),
[results](media/2026-10-22-improve-blocks/repair-parallel-retry/results.json),
[zero Factory turns](media/2026-10-22-improve-blocks/repair-parallel-retry/turns.json),
[cleanup](media/2026-10-22-improve-blocks/repair-parallel-retry/cleanup.json).
This is dirty repair atop463d, not clean-commit/native/process-crash evidence.
All18 selected sources match before/after;17 match the preceding Parallel drive,
only WorkflowRuntime differs. Post-hook18 source/18 emitted/driver comparison is in handoff.

## Current complete criterion dispositions

The [complete Round6 matrix](2026-10-22-improve-blocks-round6.md) retains every
originating141, deletion, fork, docs, epic decision1–8 and DoD row. Its detailed
unchanged proof is carried forward with2389 qualifications, not inherited acceptance.

|Requirement group|Current disposition/evidence|
|---|---|
|Generic blocks, stock graph/canvas and frozen reuse|Existing graph/config unchanged. Current modern/legacy/new/unfinished and active-result cases pass; genuine missing-container failure remains honest across Retry/reload. Independent review pending.|
|Snapshot/history/read-only Map;8 perspectives/filter; bounded nested research|Exact unchanged definitions, parser/prompts/provider guards.2389 confirms R2 research correction; original eight-perspective/concurrency4/keep-successful/two-worker/verifier proof reused.|
|Consolidate0–5/stable IDs; Decide actions; targeted Ask→Consolidate without replay|Source/input contracts unchanged; prior exact composed counts/history and actual receipts reused.|
|Refine/full criteria/paths/dependencies; selected IDs/prereqs; both Checks/DAG/all3 reviews|Source/config/limits unchanged. Prior large-batch/admissibility/feedback/correction proof retained, no replay.|
|Exact Approve/request changes/full graph display/digests/stale/currentness|Human/view/presentation/selector implementations unchanged; prior actual graph-value digest and exact approval/reconstruction proof retained.|
|File issues vs Factory launch/wait/dependency waves/canonical child/Stop/idempotency|Actions/mapping/uncertain receipts unchanged; retained controlled BOTH human+provider-backed waves/full actual child tasks and confirmed mocked backlog/stock-child proof, within original limits.|
|Optional worker inheritance/manual focus/editable triggers/callables/palette/forks exceptSimple|Declarations/catalog/UI unchanged; prior prepared provider/visible limitation/edited perspective+prompt/renamed-role/CLI/closure proof reused. Factory/Takeover otherwise unchanged pending142.|
|Deletion/search/native/history/frozen compatibility|All required old Improve executor/settings/fields/triggers/endpoints/hooks/web/CSS deletion rows unchanged; no migration. Shared permissions/native/uncertain action guards retained. New Retry tests preserve genuine history without replay or fabricated authority.|
|Full mocked E2E/restart/retry/concurrency/stale|Current narrow Retry/reload/save-boundary checks; prior exact stock composed/actual original receipts carried forward. No full-suite/native crash/overall acceptance claim.|
|Capability/whole prompts/changelog/docs/screenshots/F1|No prompt or UI change; prior full expectations/canvas/desktop390/lightdark/360/keyboard evidence reused within scope. Functional changelog updated, current small actual F1 above.|
|Epic decisions1–8, one PR/latest main/new independent review|Same PR178; generic blocks/library/inert views/targeted Ask/deletion/inherited model/universal forks retained; base is merged140, no142+. Parent owns NEW exact-head Standards/Spec/status/guarded[skip ci] squash.|
|Full suite/CI/broad/native/integrated cleanup|**DEFERRED**, not passed, until post148 under latest user policy. Actual normal hooks are separate evidence, never manually replayed.|

R1–R4 have no source change except this shared ownership-restoration function;
their precise2389 support/limits remain. Inherited64k text fallback explicitly
notices omission/requires full dashboard; literal FULL text historically PARTIAL.
Only unused nondisplayed Approve Snapshot read was previously removed under2361;
all actual pinned role/history/currentness contexts remain. No pagination/context redesign.
Older negative/setup/maxima/locator/EOF qualifications remain historical.
No dependency/global policy/protection/production/active-run/release/deploy/142+ effect.
No CI query/trigger/watch/poll/retry/finalization or repeated broad/native cycles.
Only concrete functional/logical/meaningful-performance issues block; optional
cleanup/hypothetical hardening/redundant evidence work remains deferred.
