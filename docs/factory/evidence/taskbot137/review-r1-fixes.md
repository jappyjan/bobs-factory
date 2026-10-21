# Taskbot #137 — response to independent review round 1

PR [#174](https://github.com/jappyjan/bobs-factory/pull/174), under Taskbot epic
[#135](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135). Independent review
comment **2082** requested changes on exact head
`2fbc21a3c6668551ff89605293dfbb237b41a671`, based on
`95f79ef3be57bd8aa83d53b68c8130c28ef19dc9`. That reviewed baseline and its original
reports remain intact in history. These changes are an implementation response;
a new independent acceptance review is required.

| Finding | Root cause and correction | Consequential regression |
| --- | --- | --- |
| R1: incomplete specialist assistance selected a product fixer | Stock authoring gated the incomplete branch on `reads.review`, which specialist graphs do not declare, and general blocked routing came first. Author the explicit target from `reads.impact` or the configured reviewer, before general blocked/fixer recovery. Retained snapshot reconstruction also uses the authenticated exact round from the original Check sidecar. Retain historical direct-review and impact-aware QA capture ordering. | Actual Factory, Takeover and fully renamed called graphs assert the incomplete+blocked route. Mixed-boundary stock and renamed Factory runtime drives require reassessment before the outstanding reviewer, retained inventory and every completed original receipt, no implementation/fixer replay, and ordinary guarded acceptance/merge. Original legacy blocked-specialist role counts remain unchanged. |
| R2: read-only evidence enabled an undeclared assistance protocol | The runtime accepted `review-evidence` as recovery authority. Check checkpoint recovery now requires `review-assistance`; legacy gate adapters retain their deterministic behavior. | Ordinary named `reviewIncomplete`, `reviewBlocked` and `questions` with no assistance declaration follow the terminal route, with and without read-only evidence. Focused case returns `passed:true`; actual EdgeWorker case returns `passed:false` and still follows its declared end. Neither waits or invokes a hidden agent. |
| R3: selected destination received another role's native session/visits | Recovery selected the branch target, then installed the original reviewer's conversation and charged that reviewer. Resolve the actual destination before consulting its frame-local session map or exact full-step native init event. Charge only the destination. | Direct and called renamed graphs cover reviewer session map, original native init-event fallback, a fresh alternate agent, and an alternate's own saved session. Restart both while waiting and after the destination/session/visit checkpoint is saved, before its agent starts. Assert exact native identity, visits, history, original definitions and question batch. Actual EdgeWorker nested original/alternate cases also assert native mock session IDs and visits. |

Related protocol audit: the incomplete-review and unchanged-cycle Check paths
already explicitly require `review-assistance`. Specialist baseline processing
requires `review-boundary` plus declared review evidence; QA recovery requires
its own fixed QA protocol. No generic binding/result name gained a protocol,
no original evidence authority changed, and no frozen definition is rewritten.
The R1 graph correction applies to newly authored stock definitions. Existing
accepted definitions retain their exact configured branches.

The production diff is limited to stock branch authoring and runtime recovery
identity/activation. Fixed selectors, rule budgets/yielding/cancellation, ledger,
QA/media provenance, immutable receipt sidecars, action safeguards, credentials
and dependencies remain unchanged. This restores the existing capability
reference's explicit assistance and configurable-route promises, so capability
prompt text and all expected role prompts require no change. The configuration
reference and existing PR-linked changelog entry describe the correction.

## R1 retained evidence and ownership diagnosis

The focused mixed-boundary drive reached the correct declared assistance route,
then exposed a consequential modern Check regression: retained impact snapshot
reconstruction scanned raw outputs, while original aggregate evidence lives in
the Check sidecar. The accepted reassessment `0f2d0ac5…` rebuilt as `d6d8ac85…`:
round/source/head/base and findings disappeared, and an old diff returned.
Inventory/source/environment were unchanged. The unchanged freshness and
convergence guards correctly rejected this reconstruction. The repair uses the
existing authenticated aggregate resolver with exact frame/producer/round;
missing, ordinary-producer, other-frame or other-round evidence remains invalid.

A separate first divergence occurred before assistance. Operational impact-checks
updated the assessment snapshot's trigger/inventory/digest and specialist pending
state through an alias to the accepted authored output. Inventory binding changed
from `612d6e7d…` to `8f9ac6f9…` with identical HEAD/tree/clean workspace. This
mutation exists in the reviewed/base runtime; normal stock already extracted
three times, while legacy implicit agents did not enable generic bound-input
validation. Strict effective-input freshness was correct to observe the change.
The repair publishes an independent clone of the accepted assessment and keeps
mutable operational progress in runtime decisions. No input field is ignored.

An assistance answer genuinely changes inventory effective input. The explicitly
declared independent impact protocol may inspect the exact authenticated prior
inventory as historical evidence, retaining its original binding. Consumers need
an independently current scope-reuse decision, exact original inventory/frame/
round/source and declared backedges, matching derivative marker, unchanged actual
repository binding, and live target/environment/source/dependency freshness.
Complete semantic inventory comparison rejects changed contents even with a
retained digest label. Ordinary reads and unnamed protocols gain no authority.
No original receipt is rebound to a new answer, and no fresh extraction is
claimed. This is the narrow R1 behavior-preservation boundary, not broader replay
optimization from Taskbot #145.

Disjoint source seam review found and corrected two early gaps: historical
assessor access must compare the complete original inventory including provenance
markers; assessor/fanout/consumer edges must match in both directions. Consumers
resolve the independently accepted decision's retained round even after a newer
review round exists. Historical inventory access never substitutes for newest
review/approval requirements. The source review is distinct from independent
acceptance; negative cases and final gates are recorded separately.

## Test and fixture rationale

No existing accepted fixture or outcome assertion was changed. The new
`CheckRecoveryRouting.test.ts` adds 14 focused cases. `CheckImpactRetention.test.ts` adds actual assistance/reassessment/restart and strict historical-inventory authority cases, preserving exact original receipt and binding bytes. Its custom requirement-only extraction role makes no source-revision inspection claim; the separate bound-inventory variant and stock F1 exercise actual full-input binding. This avoids pretending a source-changing repair leaves a bound inspection current. The route/native restart tests retain
native records and saved session identities rather than inventing replacements.
The native-event fallback fixture explicitly declares Codex, matching its actual
saved native event; an initial fixture omitted that runner declaration and
correctly recovered the default Claude runner. That fixture correction did not
change runtime policy.

The existing legacy blocked-specialist test passed its original counts. A
mechanical modern conversion of that legacy fixture was explored, first
rejecting nonexistent implicit legacy bindings and then reaching the old
fixture's scope/convergence assumptions before the targeted review. It was not
accepted as a product finding or as validation evidence. The exploratory
changes were removed; the original file is byte-identical to the reviewed
baseline. Modern recovery coverage instead executes actual newly authored
stock and fully renamed/called recipes, with exact retention assertions.

The F1 driver retains the original three scenarios and every existing outcome
assertion. Five opt-in scenarios add the review regressions. Only recovery
fixtures supply independently read file boundaries and reuse decisions tied to
actual runtime snapshot/receipt digests. A transparent mock start wrapper records
returned native identities and requested resume IDs; it changes no provider
behavior. A discarded optional inline-schema probe hit the existing cold-worker
limit; the alternate fixture uses ordinary generic JSON and asserts the complete
actual result. No schema limit or production safeguard changed.

## SDK guard and explicit mixed boundary

Two rejected attempts remain visible and are not final passes. Both completed
all original three EdgeWorker scenarios before the new R1 scenario stopped at
`EdgeWorker.ts`'s existing specialist guard. The first returned a blocked
correctness specialist (`/tmp/taskbot137-r1-final-f1.log`, home
`f1-generic-check-trztGX`); the second blocked the final coverage specialist
(`/tmp/taskbot137-r1-final-f1-v2.log`, home `f1-generic-check-XaqRHU`). Tracing the
actual hook established that **any** blocked or failed required SDK specialist
is rejected before its receipt is published. An initial prerequisite explanation
was superseded by this boundary diagnosis. Neither failed attempt established
incomplete-review recovery, and the SDK guard remains unchanged.

The two R1 scenarios therefore use an explicitly controlled `RuntimeHooks.agent`
result for exactly one blocked coverage invocation each, before calling the
EdgeWorker hook. This is the same generic runtime boundary used by the retained
legacy blocked-specialist test. Production runtime result validation, exact
revision checks, original frame/producer stamping, Check evidence and recovery
remain live. The blocked receipt is **not** a fresh SDK-accepted specialist and
makes no native-session continuity claim. Its turn, attempt and exact stamped
receipt are recorded separately. All other roles, including the fresh coverage
review after assistance, use the actual EdgeWorker and mock SDK.

Both mixed-boundary scenarios retain one inventory, one implementation, zero
fixer calls, two impact assessments, one execution per completed specialist,
exact original receipt digests reused for all five completed specialists, two
coverage invocations (one controlled incomplete and one SDK-complete), no
approval before assistance, and ordinary current human acceptance plus guarded
scripted-provider merge. The five completed receipts remain authenticated by
the runtime; no accepted receipt is replaced or weakened. The parent authorized
this narrow boundary in Taskbot comment 2087. A new independent reviewer must
assess whether this evidence plus the retained-result and restart tests satisfies
R1 behavior preservation; this synthetic path alone is not clearance.

A third failed attempt (`/tmp/taskbot137-r1-final-f1-v4.log`, home `f1-generic-check-ADPvdt`) reached assistance/reassessment and exposed the retained-sidecar and input ownership defects above. It is not a final pass. The stock-only focused drive then passed on diagnostic working-source hashes (`/tmp/taskbot137-r1-focused-stock-f1-v1.json`), without replaying the original three scenarios. Final source validation below is separate.

The original three stock/renamed/external scenarios and the other three new
ordinary-result/native-destination scenarios run through the actual EdgeWorker
with mock SDK agents. Native IDs in the R3 scenarios are mock provider IDs, not
live provider conversations. Durable restart coverage belongs to focused
production-runtime tests and is not claimed as an EdgeWorker restart drive.

The earlier runtime `52fb8fd3` full gates/native receipts became historical after this consequential R1 repair. The combined runtime is frozen and receives fresh complete gates/native/F1 below. Any later changes before the final drive are identified by their exact scoped inputs; no changed runtime is justified by old-source passes. Previously, only the F1 driver changed across the two rejected SDK attempts.
Exact runtime/test/build trees and built JavaScript match the completed gates
and native binary. Fresh driver syntax/Biome checks and full lint precede the
eight-scenario rerun. Broad unchanged gates/native are reused with a scoped
identity proof, as explicitly authorized by the parent. Documentation-only
commits after the drive are distinguished separately.

The first unfiltered final run on `1ff4b5c4` also remains a failed attempt:
`/tmp/taskbot137-r1-retention-final-f1.log`, home `f1-generic-check-bgXlA1`.
It completed both R1 scenarios and R2, then found a fixture representation
mismatch: the alternate returned the exact correct safe null-prototype
`{ completed: true }`, while deep equality expected a normal prototype. The
harness now asserts the exact null-prototype result; payload/session/visits and
the safe JSON guard are unchanged. Fresh syntax/lint and both focused native
scenarios precede the final unfiltered eight-scenario replay. Only the driver
changes after the validated runtime; the scoped proof preserves all nine
runtime/test/build/dependency input trees and the built JavaScript.

The first focused alternate rerun (`/tmp/taskbot137-r1-safe-json-alternate.log`,
home `f1-generic-check-cCPNJB`) then reached another fixture audit assumption:
it required a generic Finished event even though this explicit assistance path
persists an ended blocked Check attempt and human answer before routing. The
harness now verifies that exact ended attempt/type/outcome, receipt-before-end
and answer-after-end ordering, actual stored answer, and declared next start.
Ordinary Check paths still require their Finished event. This changes only the
route evidence mechanism; no agent/payload/session/visit/branch assertion or
runtime safeguard is removed. Both native scenarios then pass individually with
fresh syntax/lint before the final unfiltered replay. All failed logs/homes stay
visible; no runtime gate or binary replay is claimed for these driver-only edits.

## Validation

Validated runtime source: `1ff4b5c40c1970ec6a7b9b7542ec1901bb3c5532`. Final F1 harness source: `783919c7baa062970134c35fd19cb0c64bae1c81`.
Base: `95f79ef3be57bd8aa83d53b68c8130c28ef19dc9`; branch `taskbot/137-generic-check` in
`/Users/jappy/.t3/worktrees/bobs-factory/taskbot-137-check`. The [machine-readable index](review-r1-validation.json)
contains every full command, start/end, exit, log path/hash, input tree and native
receipt. All seven required sequential gates and all three native commands
exited **0** on clean runtime source; no partial or stopped run is counted.

| Check | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | Pass; 34 existing warnings |
| `pnpm test:packages:run --maxWorkers=2` | 315 files; 3,951 pass, 2 existing skips |
| `pnpm --filter './apps/*' test:run` | CLI 254 + F1 17 + desktop 41 pass; 1 existing desktop skip |
| `node --test scripts/tests/*.test.mjs` | All 24 files; 179 pass |
| `pnpm audit` | 0 advisories; no dependency changes |
| Focused final regression set | 10 files, 98 pass; includes all 14 route/native and two retention/authority cases |
| Original legacy blocked-specialist fixture | 1 selected pass, 25 unselected; original role/count assertions unchanged |
| Bun 1.4.2 darwin-arm64 | Build, canonical startup/restart/assets/protected API/scoped MCP and five compiled Check API cases pass |
| Final eight-scenario F1 | 8 completed; 86 mock SDK turns + 2 explicitly controlled runtime hook invocations; 20 Check executions; 45 actions |
| UI scoped reuse | 17 original PNGs, four renderers, exact pictured recipe and simulation inputs unchanged; zero new captures |

The final fresh F1 run exited 0 at the harness source above, with empty worktree
delta and unchanged executed JavaScript digest `4d38a7e7b34c7192c0b0df5c56f1b168dc6db795f8553becf09ab4705d441bea`.
[Drive report](../../../../apps/f1/test-drives/2026-10-22-generic-check-review-r1.md)
and [scenario receipts](../../../../apps/f1/test-drives/assets/2026-10-22-generic-check-review-r1/results-index.json)
separate all boundaries and retained rejection evidence. Four publications and
four SHA-guarded scripted-provider merges require explicit current acceptance;
external delivery retains independent readbacks and stale-approval rejection.

The native binary SHA-256 is
`07e232f30151d1b4266e6316379003dfb0768cc1036b3db749ccc35d5cc42005`; resource digest
`cd8af2b5060c4de2bab1980d86ef872b3d7081df760b1b8bdae1fef172f0635c`.
Its producer's build metadata still says pending runtime smoke; the separately
recorded successful canonical and API receipts provide the completed smoke
result. No release artifact or production install was published.

[UI equivalence](review-r1-ui-equivalence.json) proves unchanged screenshots,
renderer and pictured recipe/simulation only. Changed stock graph, impact/specialist evidence and recovery
runtime are excluded and covered by the fresh tests/F1. The fresh web build
remains `0317923a2f79a813228a55be`. Original ff5e2b20 reports remain historical.

Only the F1 driver differs between validated runtime and final harness: the fixture now asserts the exact safe null-prototype output, verifies answered checkpoint provenance and supports focused native-scenario selection. Every payload/session/visit assertion remains. All nine runtime/source/build/test/dependency input trees match; fresh driver syntax, Biome, full lint and both focused native scenarios pass. The final harness is
exercised by the fresh eight-scenario drive. Later changes only add/update
these evidence documents and indexes; their exact scoped diff is recorded in
the PR/final packet. No unchanged broad gate, native build or UI replay is
claimed as freshly rerun after those evidence-only commits.

Limits: deterministic mock agents and scripted providers, synthetic human
answers, zero paid calls, no live model-quality/authentication/remote-merge
coverage, only darwin-arm64 binary smoke. Takeover is graph-inspected, not an
executed delivery drive. R1's two blocked results use the explicitly labeled
runtime hook; they do not establish SDK acceptance or native continuity.
Durable restarts and destination visit/session identity are covered by the
focused production-runtime tests, not a restarted EdgeWorker F1 process.
Independent acceptance and CI remain pending; this response is not clearance.
