# Task147 — durable recipe progress

Implementation handoff evidence, 23 October 2026. Independent Standards/Spec
acceptance, ticket status and merge remain coordinator-owned.

Base `43f305fc33fed451326db0b6fcbe09e779e2b954`, tree
`ddc03bfc5201dbdc94520509917dd66e74150388`, sole parent
`6a25d1659c4a9e475596408500117af81b83f2b5`, subject
`fix(factory): shorten shared mutation reservations (#183) [skip ci]`.
Own checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-147-progress`,
branch `taskbot/147-progress`. The manual checkout does not rebind the inherited
T3 coordinator workspace. All product commands used explicit own working directories.

## Audit and implementation

Live147/135, completed107 including745, and completed132 including1905 were read.
Current StepVisitBudget owns custom limits and recorded additional visits;
WorkflowRuntime owns retained graph/Call/Parallel/For each checkpoints and Retry.
Impact.recordConvergence owns validated semantic review repeats, independently
of its assessor's prose. EdgeWorker owns scoped MCP readiness, native resume,
reserved schema attempts, idle recovery and rejected candidates. These installed
owners were audited before live147 comment2568 and implementation.

The gap was local budgets attached to individual frames/roles and impact keys.
Ordinary new child frames and alternate routes could repeat unchanged work while
local budgets remained acceptable. Infrastructure-only retries had no cumulative
observation, and new commit IDs could replenish local schema budgets despite an
unchanged source tree.

The accepted root recipe now optionally declares `convergence`. New bundled roots
opt in; old accepted graphs/forks without it retain their existing safeguards.
The saved run policy applies to children, independently of child policy claims.
Runtime observes actual admitted attempts, committed trees, accepted human input,
validated Check consequences and the existing independent Impact semantic evidence.
Correction-route selections, prose, attempt IDs, dates and empty commits do not
establish progress. Original observations survive source/evidence A→B→A cycles.
Structural paths distinguish different Parallel/For each bodies with identical
local role names, while new Call frames retain definition identities.

Physical native turns charge after capacity/resource admission. Mandatory context
failure is infrastructure, with its own retained retry generation, never schema
rejection. Supported native identities survive fresh frames/restart. Passive CI,
queues, human waits and downtime do not accrue correction attempts. Existing
custom visits/grants, schema corrections and impact ceilings remain required.

Failure retains its exact operation, relevant identity, attempted work and blocker.
The existing authenticated Retry/Continue path records a bounded grant for only
the blocked observation. It preserves original history, successful siblings,
checkpoints, accepted definitions and all review/human/provider proof. The public
run projection exposes only a compact explanation. Recipes' existing JSON editor
preserves the optional policy; no new visual surface or timing dashboard was added.

See [operator semantics](../../../docs/factory/convergence.md) and
[compact hashes/results](taskbot147-progress-summary.json).

## Applicable controlled F1 family

Runtime/session changes require F1 under the canonical policy. This is one small
relevant mocked family: `assets/taskbot147-progress.mjs`, invoked through
`test/ProgressBudgetF1.test.ts` with the source test loader. It uses production
WorkflowRuntime, public validation schemas, actual isolated Git and the protected
FactoryServer API fixture. Only the unrelated packaged web shell is omitted.
Role execution is scripted; no model, live forge, development CI or native agent
is invoked by the F1 family.

Actual role sequence: `left/repair`, `right/repair`, `left/repair`, `right/repair`;
then assistance at the left observation (2 attempts). Process reconstruction
preserves exact progress state, history, checkpoint and synthetic native identities.
A request lacking the mutation guard gets403. Explicit authenticated Continue
executes exactly one additional `left/repair`; a duplicate active Retry gets409.
The right observation receives zero extra credit and pauses at its original2.
The one grant records allowance1 and resulting left limit3. No fixed savings,
production model judgment, cost or timing improvement is claimed. No BASE
comparison was performed; these are actual candidate invocation counts.

## Frozen checks and honest stages

Node24.21.0. Existing `/opt/homebrew/bin/pnpm` resolves10.33.1; login PATH's pnpm
was12.8.1. Frozen-lockfile installation reused757 cached packages with scripts
disabled; no manifests/lockfile changed. Tests used own private HOME, TMPDIR and
CLAUDE_CONFIG_DIR beneath `/tmp/taskbot147-implementation.s3jfk6`.
Selected fixtures/setup were inspected for writes and shutdown. Neither forbidden
legacy Call suite nor any of the three excluded142 paths was accessed/executed.

Each execution stage froze source/test/harness hashes, with no edits during its
checks. All current hashes and log digests are in the compact summary. Commands
below ran from own `packages/edge-worker`, except source types/format from own root:

```sh
/opt/homebrew/bin/pnpm exec env HOME=<own>/home TMPDIR=<own>/tmp CLAUDE_CONFIG_DIR=<own>/claude F1_RESULT=<own>/tmp/f1-stageC.json vitest run --config <own>/vitest.config.mts test/ProgressBudget.test.ts test/ProgressBudgetF1.test.ts --reporter=default --reporter=json --outputFile.json=<own>/stageC-tests.json
/opt/homebrew/bin/pnpm exec tsgo --project <own>/tsconfig.json
/opt/homebrew/bin/pnpm exec env HOME=<own>/home TMPDIR=<own>/tmp CLAUDE_CONFIG_DIR=<own>/claude vitest run --config <own>/vitest.config.mts test/EdgeWorker.capture-recovery.test.ts -t 'bounds required-MCP'
```

- **Current C:**22 focused production-runtime regressions plus1 F1, exit0; changed
  owner source-alias TypeScript compilation exit0. The alias project includes
  actual transitive package sources, core's owned-resource subpath and the existing
  sqlite declaration. It does not build/recheck the monorepo or native binary.
- **Current D2:**1 selected EdgeWorker/MCP recovery test, exit0,48 skipped. It runs
  the real source stdio context server under the existing tsx loader and performs
  required `list_context`/`read_context` probes after same-head repair. The native
  model runner is scripted; original rejected candidate, schema attempts, native
  identity and bounded grant are asserted. Child transport closes before return.
- **Scoped B reuse:**2 new physical native-hook recovery cases passed,47 skipped;
  the output-validation case and relevant EdgeWorker/ProgressBudget attempt logic
  remain unchanged. D2 strengthens the infrastructure case with the real MCP probe.
- **Scoped B reuse:**5 full routing prompt cases passed with complete expected
  prompts/components/type/verify; those prompt source/fixture hashes remain exact.
- Focused Biome, MJS syntax and `git diff --check` complete before publication.
  No unchanged full prompt/native/runtime matrix is credited as freshly rerun.

Earlier stages remain qualified: preliminary compilation first failed on an own
missing return plus temporary source-alias omissions. A second preliminary compile
passed but may overlap the helper's single test-file addition; it is not final
proof. StageA's test launcher failed before product execution because replacing
HOME made pnpm search a nonexistent private toolchain (an automatic private-home
Corepack download was attempted). Corrected launcher A2 passed25 runtime/F1/prompt
cases; its native command had1 pass/1 failure because infrastructure was relabelled
output validation. That bug was fixed before B (27 runtime/F1/prompt +2 native
passes). C fixes cloned-body structural identity and adds its regression. An initial
D edit/format command used package cwd with root-relative paths and failed before
editing files, then redundantly ran the unchanged selected test (exit0); no real-MCP
credit comes from that stage. D2 uses the corrected fixture and owns real-MCP proof.
None of these stages is labelled a broad/native/CI pass.

## Task147 acceptance and epic compatibility

| Requirement | Evidence / scope |
| --- | --- |
| Audit current107/132 controls first | Current owner audit above, live2568, completed helper readback |
| Durable generic state across calls/routes/Parallel/For each/restart | C fresh-frame ping-pong, interruption/restarts, sibling preservation; F1 exact reconstruction |
| Substantive source/input/evidence progress | C real changed trees, A→B→A, accepted answers, actual files-exist Check; empty commits/dirty/prose/UUID claims negative |
| Repeated invalid output/tool/infrastructure/base mismatch pause | B physical production EdgeWorker validators; D2 real scoped MCP; C retained base/output/infra failure identity |
| Passive waits/146 coordination preserved | C actual human/CI/capacity/resource waits under advanced clock, zero queued attempts; unchanged admission/fairness owners |
| Native conversation and original evidence retained | C/F1 synthetic native IDs and exact history/checkpoints; B/D2 production resume config, original rejection and repair |
| Bounded explicit auditable Continue | F1 protected API, one exact-state grant, duplicate rejection, other route remains capped; C actual merge guard still rejects absent human approval |
| Custom limits, grants, legacy and accepted policy | C original custom limit+4 recorded visits, old graph guard, catalog edit cannot replace accepted root policy; labelled missing-history window implementation review |
| Configurable generic policy and explicit adoption | Public schema ranges/defaults, saved run copy, JSON editor pass-through, saved-copy/new-run documentation; no active graph upgrade |

| Epic decision / DoD | Treatment |
| --- | --- |
| 1 configurable agent building block | Generic root policy/physical hook, no role/repository/provider/reviewer-count dispatch |
| 2 generic Check | Real Check evidence supplies semantic progress; pure rules do not acquire approval authority |
| 3 For each | Retained keyed items and successful results; structural body identity regression |
| 4 side-effect actions | Original receipts, uncertainty and downstream obligations remain required; no new action scheduler |
| 5 declarative human views | Accepted validated decision input can advance context; no approval manufactured |
| 6 Improve codebase composition | New saved bundled root policy only; existing graph/forks retained |
| 7 Factory/Takeover composition | Root policy inherited through calls; no foundation reimplementation |
| 8 Ask/check-in/human/external review views | Existing protocols, original decisions and quality boundaries retained |
| One latest-main ready PR + links/changelog | Publication identities and full BASE…HEAD inventory supplied in live147 handoff |
| Relevant F1, restart/retry/concurrency checks | Current C/D2 and exactly scoped B reuse above |
| Capability reference/full prompt fixture/docs | Updated Workflow.ts and entire routing fixture; convergence docs/contracts/changelog |
| UI evidence | No visible flow/layout change; no artificial screenshots; existing matrices not recertified |
| CI/full local gates/native build | Skipped/deferred to ONE integrated post148 phase under user override, not passed |
| Reviews, guarded squash, ticket statuses | Parent's NEW whole-diff independent Standards+Spec loop and root integration; no self-clearance/merge/done |

## Boundaries and retained history

No production install, active-run editing, deployment/service restart, live model
credit, live provider mutation (outside authorized PR publication), account/native
credential/history access or Task148 implementation. MCP probes establish local
scoped transport readiness; scripted native IDs/configuration do not certify native
OS permission enforcement, subscription-provider behavior or arbitrary OS crash
recovery. Shutdown/reconstruction is controlled graceful recovery, not kill9 proof.
All test-owned runtimes, API/auth timers, MCP transports and streams terminate.

Historical132/1905 real-provider/browser/media/context limits remain historical.
The exact143 three BASE failures/missing final proof,144 BASE long-run failures,
145 BASE partial-prefix limitations and146 earlier NOT CLEAN stages remain
unchanged; this report does not replay or relabel them. Current146's scoped eight
checks/authenticated reuse remain scoped, not a full/native/CI certification.

Normal push/LFS and repository workflows/protection/security stay intact. The broad
pre-commit build/typecheck is deferred per user policy through command-local hook
selection; it is not a passed or absent hook. Command-local signing disablement
uses the explicitly authorized147 exception, without saved signing/auth/key changes.
Any own generated untracked hooks are moved intact only after Git mutations, with
hashes and exact restoration obligation recorded in the final live handoff.
