# Task147 — durable recipe progress, combined Round1 repair

Implementation handoff for the same [PR184](https://github.com/jappyjan/bobs-factory/pull/184).
The previous `3fc0f9d5b5f4e2b78891aa609791139330fb8fc0` / tree
`bbe4824f277089dfe2fc6dd99336b834fa55831c` remains historically **NOT CLEAN**:
independent whole-diff report147/2574 identified four unique P2 defects. This
candidate repairs them together. New independent Standards/Spec review, root
integration, statuses, guarded squash and148 sequencing remain parent-owned.

Base `43f305fc33fed451326db0b6fcbe09e779e2b954`, tree
`ddc03bfc5201dbdc94520509917dd66e74150388`, sole parent
`6a25d1659c4a9e475596408500117af81b83f2b5`, subject
`fix(factory): shorten shared mutation reservations (#183) [skip ci]`.
Retained checkout `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-147-progress`,
branch `taskbot/147-progress`; manual creation never rebound the inherited T3
coordinator workspace. Every product/source/install/check/Git command uses the own
checkout explicitly. Final Git/provider identities and whole BASE…HEAD inventory
are recorded in the live147 handoff; this report does not substitute repair hunks
for the original whole comparison.

## Audit and behavior

FULL current147/135, completed107/745 and132/1905, and authoritative2574 were read.
The original owner audit is retained in live2568: StepVisitBudget owns custom limits
and additional visits; WorkflowRuntime owns graph/Call/Parallel/For each checkpoints
and Retry; Impact.recordConvergence owns independent semantic review repeats;
EdgeWorker owns scoped MCP readiness, native resume, schema corrections and recovery.
There is one accepted optional root convergence policy, not a new scheduler or
assessor. New saved bundled roots opt in; policyless accepted graphs keep their
original guards. Catalog edits cannot change accepted definitions or policy.

Actual admitted attempts use committed source trees, accepted host/lexical input
and validated Check/independent Impact evidence. Passive CI, queues, human waits
and offline time spend no correction credit. Reworded output claims, attempt IDs,
empty commits and fresh frames do not replenish it. Existing custom visit grants,
schema limits, original receipts, native sessions and quality gates remain required.

| Finding | Combined repair and consequential proof |
| --- | --- |
| ROOT1 / SPEC1: Call erased enclosing scope | Called-definition identity retains its enclosing structural body/item/Call path. Three distinct For each bodies, identical item/data and same child all perform their first execution:3 calls,3 operations,1 identity. Same child work in the same enclosing scope still shares counters across routes/fresh frames. |
| ROOT4: accepted mapped values absent | Private origin hashes track actual accepted launch/lexical inputs through Call/Parallel/For each and nested aliases, without copying values or scanning history. Independent same-operation test holds all root A/B/C values fixed: A,B,C,A execute, next A pauses;3 observations with attempts1,1,2. Nested accepted strings also execute3 times under1 operation. A separate forwarded role-prose case remains1 observation/2 leaf executions. |
| ROOT2 / SPEC2: human receipt UUIDs minted credit | Progress uses validated choices/feedback/fields plus meaningful configuration/display content. Original exact request/output/batch/digest/currentness/consent validation and immutable receipts remain unchanged. Actual runtime + HumanViews + answerView tests cover feedback, per-item choices, fields and display: each A→B→A→A sequence retains4 exact distinct view receipts, executes4 physical roles, then pauses on retained A. |
| ROOT3 / StandardsS1 / SPEC3: full window could not Continue | The exact blocked window records count/allowance. Explicit Continue records4096 additional slots, prior allowance and blocked key; duplicate direct Continue does nothing. Existing observation counters and attempt grants are retained. Actual production begin/continue with real Git and a public validated1000-item/five-leaf definition admits4096 observations, blocks the next before execution, grants4096 slots, admits4097, and still enforces the original2-attempt cap on an old observation. |

The window proof is deliberately an exported production-owner seam: optional
per-admission save is omitted; it does not execute/persist/restart the entire5000-leaf
graph or drive the large-window condition through API. The small F1 below owns
ordinary protected API continuation/restart/checkpoint/sibling guarantees. No
shadow counter, patched authority, synthetic human receipt or permissive validator
establishes the four repair results.

## Current frozen checks and small mocked F1

Actual Node24.21.0; existing direct pinned pnpm10.33.1 launcher is
`/Users/jappy/Library/pnpm/.tools/pnpm/10.33.1/node_modules/pnpm/bin/pnpm.cjs`.
No new dependency/install/build preparation was needed for the repair. Own private
HOME/TMPDIR/CLAUDE_CONFIG_DIR live beneath `/tmp/taskbot147-repair-r1.jgsy92mi`.
Selected setup/harness writes and shutdown were inspected first. No forbidden142
Call suite or excluded diagnostic was accessed or executed. Source/test/harness
hashes were frozen and unchanged during each check stage.

Commands below use own `packages/edge-worker`, except types/format/diff use own root:

```sh
env HOME=<proof>/home TMPDIR=<proof>/tmp CLAUDE_CONFIG_DIR=<proof>/claude F1_AGENT_MODE=mock F1_RESULT=<proof>/tmp/f1-stage2.json node node_modules/vitest/vitest.mjs run --config <proof>/vitest.config.mts test/ProgressBudget.test.ts test/ProgressBudgetF1.test.ts --reporter=default --reporter=json --outputFile.json=<proof>/stage2-tests.json
env HOME=<proof>/home TMPDIR=<proof>/tmp CLAUDE_CONFIG_DIR=<proof>/claude node node_modules/vitest/vitest.mjs run --config <proof>/vitest.config.mts test/EdgeWorker.capture-recovery.test.ts -t 'bounds physical invalid-output|bounds required-MCP' --reporter=default --reporter=json --outputFile.json=<proof>/stage2-physical.json
env HOME=<proof>/home TMPDIR=<proof>/tmp CLAUDE_CONFIG_DIR=<proof>/claude node node_modules/@typescript/native-preview/bin/tsgo -p <proof>/tsconfig.json
```

- R1B runtime family:31 production-runtime regressions +1 F1, exit0. Includes
  fresh-Call two-route ping-pong, relevant source/input/evidence changes, A→B→A,
  base/output/infrastructure failures, interruption/restart, completed Parallel/For
  each siblings, waits, original custom limits/grants and actual no-human merge guard.
- R1B physical recovery:2 passed,47 skipped, exit0. Physical invalid output is
  bounded; same-head infrastructure repair uses real local source stdio MCP and
  required list_context/read_context probes while retaining the scripted native
  conversation and original rejection. No native model is started.
- R1B owning source-alias compilation exit0. It follows actual transitive package
  sources/core owned-resource subpath and existing sqlite declaration, not a full
  monorepo or native build.223 source/test/harness inputs retain the final freeze.
- Exact unchanged reuse only: historical B's5 complete routing prompt assertions
  (entire system/user prompts, components, type, verify). Workflow.ts and expected
  fixture hashes match. The existing capability contract already promises semantic
  progress and bounded continuation; this repair requires no prompt text change.
- Focused changed-file Biome and diff checks are recorded in the live handoff.
  There is no full-suite/native/CI claim and skipped tests receive no credit.

F1 is required by canonical applicability: runtime/session behavior changed.
ONE small relevant family uses production WorkflowRuntime/public schemas, real
isolated Git, authenticated FactoryServer API fixture and scripted role hooks;
only the unrelated packaged web shell is mocked. Actual sequence is
left/repair,right/repair,left/repair,right/repair, then left assistance at2 attempts.
Reconstruction preserves exact progress/history/checkpoint and synthetic native IDs.
Missing mutation guard403; authenticated Continue executes exactly one more left;
active duplicate Retry409; right remains capped2. One attempt grant records1/limit3.
No BASE comparison, savings, cost, timing or real-model judgment is claimed.

See [compact results and hashes](taskbot147-progress-summary.json) and
[operator semantics](../../../docs/factory/convergence.md).

## Failed stages and history remain qualified

R1A's first compiler launcher used nonexistent tsgo.js and exited1 before compilation.
The corrected launcher found import casing and one missing TypeScript narrowing,
exit1. Runtime/F1 R1A had30 passes/1 failure: a new owner-only test incorrectly
expected a graph checkpoint even though it never launched the graph; all preceding
slot-grant/admission/counter assertions passed. Corrected only after checks ended;
R1B froze and passed the final source. No existing assertion, timeout, validator,
native guard or quality requirement was weakened.

Original C23, D2 selected1/48 skipped, and B5 prompts/physical tests remain historical
at their recorded source scopes; current runtime/native-hook execution above
supersedes reuse for changed owners. The original preliminary missing-return/alias
compiles, possible helper-addition overlap, private-HOME pnpm bootstrap failure,
A2 infrastructure-as-schema failure, B correction, C direct-body fix and D wrong-cwd
edit/unchanged rerun remain recorded in the original report at old3fc0f9d5 and live2569.
Those stages and review2574's four negative confirmations are never relabelled passes.

## Complete147 acceptance and compatibility

| Requirement | Current implementation evidence / limits |
| --- | --- |
| Audit107/132 and current installed guards first | Full live audit2568/current owners plus FULL2574 before combined repair. |
| One generic durable policy across Call/Parallel/For each/routes/restart | R1B fresh frames, accepted root inheritance, retained state and completed siblings; ROOT1/4 independent identity axes above. |
| Relevant source/accepted input/findings/dispositions/new evidence; no prose/UUID/empty-commit credit | R1B committed trees and A→B→A, actual files-exist Check/independent Impact facts, accepted lexical hashes and human semantic tests; negative forwarded role claims. |
| Passive CI/capacity/resources/humans/downtime separate | R1B wait controls under advanced clock, zero queued attempt credit;146 owners unchanged. |
| Repeated schema/tool/infrastructure/base failures bounded and actionable | R1B failure/reconstruction cases and2 physical hooks with actual scoped MCP; no live moving-provider experiment. |
| Same-head repair/native resume/original rejection retained | R1B real local context probes, schema0 on infrastructure failure, recorded retry generation and synthetic native identity. Native model/OS enforcement untested. |
| Preserve checkpoints/receipts/accepted work/siblings/uncertainty/obligations | Small F1 exact restart state/history/checkpoint plus both sibling cases; no automatic completion, approval or merge. |
| Explicit bounded auditable continuation/current state/duplicates | Current F1 ordinary403/409/one attempt grant/other-route cap; production window4096-slot grant/old counters/duplicate no-op; no large-window API/restart claim. |
| Original custom limits/additional visits/quality guards | R1B original limit and4 recorded additional visits, separate schema/Impact ceilings and actual missing-human merge negative retained. |
| Honest legacy window/accepted immutable policy | R1B old policyless graph and accepted policy controls; missing history is labelled legacy-from-now, no invented prior credit or active migration. |
| Generic configuration/capability/builder | Public schema defaults/ranges, saved recipe JSON pass-through, unchanged complete capability contract/fixture; repository/provider/role/reviewer-count agnostic. |
| Bounded incremental context/private origins | Small origin hashes, bounded recent/grant facts, no accumulated-history scan; all earlier observation counters retained with explicit slot grants. No148 telemetry. |
| Frozen graphs/forks/native conversations/explicit opt-in | Accepted run definitions/policy remain saved; opt-in adoption is saved copy/new run. No production upgrade/edit. |
| Focused F1/restart/actual work counts | Current32+2 scoped cases above, scripted native execution/controlled local MCP; no model judgment/production efficiency claim. |

| Epic135 decision | Treatment |
| --- | --- |
| 1 Every bundled recipe/subrecipe forkable except Simple | Preserved; policy remains recipe data copied through JSON authoring. |
| 2 Configured generic agent, Check, flow/human/explicit actions | Existing interpreter/physical execution boundaries; no step-name/repository/provider scheduler. |
| 3 Library and custom JSON Schema output formats | Real production output validator remains in physical invalid-output tests. |
| 4 Declarative bound views, no HTML/scripts | Existing validated human-view runtime; only semantic progress normalization changes. |
| 5 Dedicated Ask follow-up/reconsolidation | Unchanged; no broad Ask replay or new assessor. |
| 6 Old improvement routine deleted | No hidden routine restored; ordinary saved graph composition retained. |
| 7 Worker model inherits unless configured | No forced model/provider or fanout change. |
| 8 Foundation-first sequence | Only147; parent owns review/merge/status/148. |

| DoD | Disposition |
| --- | --- |
| One ready latest-main PR, ticket link/changelog | SAME184, actual Unreleased link, attachment237 and final exact Git/provider identities in live handoff. |
| User skip-CI policy | Every branch subject[skip ci]; no development CI/check/status/workflow/main-health/provider-finalization query/watch. Parent squash must retain[skip ci]. |
| Independent Standards/Spec acceptance/fix loop | Combined four-defect response only; NEW whole-diff independent review required, no self-clearance. |
| Consequential tests/retry/restart/concurrency/stale state | Current R1B32+2 scoped checks; original failures and narrow window scope explicit. |
| Capability/full prompt/docs | Contract already covers repair; authenticated unchanged B5 full prompts, operator docs/changelog/current report updated. |
| Changed UI screenshots | No visible flow/layout change; no artificial screenshots or unchanged UI matrix recertification. |
| Full build/types/lint/packages/apps/scripts/audit/native/integration | DEFERRED, NOT PASSED: ONE integrated post148 cleanup under user override. No dependency change. |
| Guarded squash/status/strict sequence | Parent-owned after FULL report/new independent reviews. Epic remains open. |

## Foundations, boundaries and cleanup

141 atomic ownership/no false completion/no sibling replay;142 qualified lexical
inputs/original owner/revision/native identity/current visits/Snapshot authority;
143 current Ask/saved-reader/exact URL/head/assets/consent;144 immutable fullrefs,
alias provenance/detached isolation/warm cache;145 original assessor/requirement IDs,
qualified impact reuse/original receipts/cumulative94 human policy;146 capacity-first,
active/draining/uncertain owner exclusion/shared QA/fairness/observed wait credit
remain required. No foundation scheduler, telemetry or broad matrix was reimplemented.

Historical132/1905 provider/browser/media/stream/context limits (including about35%
more context),143's exact3 BASE failures and external missing-final-proof negative,
144 BASE24-round120s failure/223MB STOP/two EOF cleanup,145 partial-prefix/not-all-eight
proof and146 old NOT CLEAN/F1 timing limits remain historical. No replay or relabelling.

No paid/live model/native/provider/device/production/active-run/install/release/deploy/
service/account/key/private native history effects occurred, apart from authorized
Taskbot/PR coordination. Local transport and scripted native identity do not certify
native OS permission enforcement, remote providers or arbitrary process crash.
All owned runtimes/API/auth timers/MCP/streams end; only owned private homes are
cleaned. Original helpers remain terminal/no pending; no new helper was needed.

Normal push/LFS/workflows/protection/security remain intact. Command-local unsigned
publication and explicit broad-precommit deferral are authorized147 exceptions,
without saved policy/config/key changes or hook-pass/absence credit. Own generated
wrappers were restored intact before Git mutations. Any later intact move and exact
restoration obligation are recorded in the final live handoff.
