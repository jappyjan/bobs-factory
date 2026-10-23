# Task146 — shared mutation reservations

Implementation evidence, 23 October 2026; acceptance remains parent-owned.
Original A/00cf evidence is historical and NOT CLEAN at independent report2550.
See the combined-repair section and summary.repair for current proof.
Base: `6a25d1659c4a9e475596408500117af81b83f2b5`, tree
`1317fec25dc41e41ad26c48ef2bd2c93a330e967`, sole parent
`c30d563525f0d9726858f1b6ada83aebb54d687b`.
Task: https://taskbot.apps.janjaap.de/p/bobs-factory/t/146 under epic135.

## Audit and change

Live146/135 and108/126/109/89/101 were read. Completed108/126 already own
instance-local delivery coordination, affected-target/group reconciliation and
asynchronous tracking.109 owns passive CI and bounded retries.89's machine
capacity still exchanges eligible workflow admission positions by original run
age; this change does not replace that policy or raise capacity.101's durable
comment/transcript ownership and TicketTracking/outbox remain unchanged.

The remaining causes were whole-hook reservations before capacity admission,
combined correction/push roles, original run age and recycled `queuedAt`, plus
terminal status excluding a mutator before its abort cleanup settled. Graceful
shutdown also discarded continuously queued wait priority.

New stock correction roles explicitly declare local work and a following visible
publication action. Continued publication binds its original executed receipt or
accepted takeover source, verifies the original branch/open PR, and preserves its
draft state. Generic access carries the boundary and completion intent. Capable
agent hooks reserve after capacity and retain exclusion through cleanup; legacy
combined push roles retain a reasoned conservative boundary. Scripts/intensive
actions obtain capacity before resources. The existing coordinator adds bounded
completion preference, 60-second continuous-wait aging, grouped reconciliation,
replacement fencing, draining-owner/uncertain-external protection and safe
cyclic-expansion failure. Final merge rereads current human decisions after waits.
No new scheduler, tracker, approval assessor or telemetry framework.

## Controlled F1 comparison

Required for changed runtime behavior. Driver:
`assets/taskbot146-reservations.mjs`, executed by
`packages/edge-worker/test/ReservationF1.test.ts` using the source test loader.
Both variants use the identical final fixture and full pinned BASE versus current
edge-worker source. Authenticated Factory API injection creates the runs; real
isolated Git worktrees supply revisions. Publication hooks, human decisions and
forge responses are scripted. Actual FactoryTools merge/readiness/recovery guards
execute. The unrelated static UI shell is an empty mock; no port is bound.

While the fixer remained active:

- BASE: publication owner `repair:mutation`; the other delivery queued on the same
  repository/main target; **zero merge requests**. Its wait was at the prepared
  PR publication action, before its merge action — not claimed as an already
  admitted merge.
- Candidate: the local fixer owned **no publication reservation**; the delivery
  executed its publication action and merge, with **one merge request** before
  the fixer finished. The merge reservation released before passive provider wait.
- Both variants stop the passive wait, restore saved state, consume a scripted
  provider-confirmed merge, retain the original human decision, and submit no
  second merge request. Unknown submission is not reported complete before that
  confirmation. Candidate shutdown interrupts unfinished local correction; this
  drive does not claim its later publication completed.

Final common BASE fixture: `f1-before-10.log`, exit0, one test.
Final product source: `f1-after-3.log`, exit0, one test. Original detailed receipts
are outside source in `/tmp/taskbot146-implementation.QGBiDn/tmp/`; the compact
[summary and exact input hashes](taskbot146-reservations-summary.json) are committed.
No synthetic timing/cost saving, live native/model/forge certification, arbitrary
process-crash proof or universal exactly-once guarantee is inferred.

## Focused checks and source scopes

All commands ran with explicit own cwd. Tests use
`TMPDIR=/tmp/taskbot146-implementation.QGBiDn/tmp` and a private test Claude debug
directory; inspected fixtures contain no unconditional other-owner output writes.
Neither forbidden CallVisitInputs/CallFreshness suite nor the three forbidden142
artifacts was executed/accessed. Source/harness edits occurred between stages.

- Frozen current stageG: four selected source test files, **11 passed /30 skipped**,
  exit0: original-authority continuation, missing provenance, queued human rejection,
  current-head recheck after provider polling, full routing prompts and full stock /
  frozen legacy role prompts. Skipped cases are not credited by this command.
- StageH: actual nested For each → Parallel → Call resource leaves, **1 passed /8
  skipped**, exit0: four qualified visits, peak shared mutators1, all claims released.
- StageC: **13 fairness +26 coordination cases passed**; its combined command was
  exit1 because a new fixture still had wrong provider identity. These passes are
  reused only for unchanged coordinator/runtime mechanisms; later continuation/
  merge admission changes have separate stageG coverage. Cases include sustained
  arrivals/aged corrections, fresh versus recycled age, atomic targets/expansion,
  stale replacement, queued restart, cancellation/draining, unconfirmed external
  execution, real shared QA, passive CI and queued-fixer negative controls.
- StageE: six runtime boundary cases passed, exit0 (capacity-before-resource,
  capable-hook cleanup, legacy fallback, cancel cleanup, access validation and
  current human rejection). Two continuation cases were subsequently added and
  passed atG; the nested case was subsequently added and passed atH. No single
  all-final-file/full-suite execution is claimed.
- StepConfig's12 cases passed atA and its source stayed unchanged thereafter.
- Changed-owner source typecheckG, exit0, using a temporary source-alias project
  extending the worker's tsconfig, including its transitive sqlite declaration.
  This is not a whole-monorepo build/typecheck.
- Full prompt assertions remain full prompts/components/type/verify. Expected
  stock prompts intentionally changed for local correction. A direct comparison
  retained **429 frozen legacy/conservative entries byte-for-byte** (shared
  capability text remains the fixture's existing full-expansion token).
- Final changed-owner Biome exit1: only the F1 driver's two-call line wrapping
  and a useTemplate style suggestion. These nonfunctional items are deferred
  under the epic threshold; no lint-pass claim or source/harness change after F1.
- `pnpm install --frozen-lockfile --ignore-scripts` exit0; manifests/lock unchanged.
  Only core dependency emit (`pnpm --filter bobs-factory-core build`) ran, exit0.
  Login Node24.22.1; pnpm executions Node24.21.0; pnpm10.33.1. Bun1.4.2 was used
  only by failed source-loader attempts. No dependencies changed.

Exact command templates:

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run --config /tmp/taskbot146-implementation.QGBiDn/focused.config.mjs <files> [-t <selection>]
pnpm exec tsgo -p /tmp/taskbot146-implementation.QGBiDn/owner-typecheck.json --noEmit
F1_AGENT_MODE=mock F1_RESULT=<own-TMPDIR-json> pnpm --filter bobs-factory-edge-worker exec vitest run --config /tmp/taskbot146-implementation.QGBiDn/focused.config.mjs test/ReservationF1.test.ts
# BASE additionally sets F1_RUNTIME_SOURCE to the own extracted pinned factory source.
```

Earlier attempts remain failures: stageA39 passed/7 failed plus2 suite-load
failures; B49/3; C44/1; D5/1. Typecheck preflight and mutable-tuple/narrowing errors
were fixed before finalG. F1 attempts1–3 failed source initialization;4 lacked
packaged shell;5 timed out;6–7 lacked a valid publication read;8 correctly failed
missing original publication provenance. BASE9 and candidate2 are historical
scoped passes; candidate1 reached assertions but failed duplicate fixture cleanup.
A preparatory Python edit failed parsing before writing files. See the summary
for individual exits/scopes; none is relabelled as passing final evidence.

## Compatibility and limits

All eight epic foundation decisions remain: generic configured roles/checks,
For each/Parallel/Call, explicit side effects, declarative human views, composed
Improve with targeted follow-up, forkability except Simple, Factory/Takeover
subrecipes and exact native human boundaries. This ticket extends access and
publication actions; it does not redo136–145, progress budgets147 or telemetry148.
Accepted graphs/forks, native sessions, original evidence and original human
approvals remain retained. Existing132/145 impact/reuse and94's cumulative
continuation/required checks remain authoritative. New local boundaries are
trusted workflow authority, not a new OS sandbox; combined unrestricted roles
without the declared split retain broad exclusion. Adoption is a new saved copy
and new run; no production upgrade or active-run edit.

Historical108/126/109 live/provider/native completion evidence is not rerun or
promoted to current certification.141–145 historical qualifications and deferred
failures remain unchanged. No UI code changed; no new UI matrix or148 dashboard.
No development CI/check/status/workflow query or trigger. Broad build/type/lint/
package/app/script/audit/native validation is deferred to the integrated post148
phase, not passed. Independent whole-diff Standards+Spec review, statuses and
squash merge remain parent-owned.

## Combined repair after independent Round1 (live146/2550)

The original sections/receipts above describe A/`00cff70a` and remain historical.
That candidate is **NOT CLEAN**, with two independently confirmed P1 defects.
The complete authoritative report2550, both verbatim axes and their failures
remain on Task146; this follow-up does not replace it or inherit acceptance.

- **R146-ROOT-1 = Task146R1-STANDARDS-S2 + Task146-SPEC-1:** grouped continued
  publication required authority even for unchanged context. It now skips an
  unreceipted grouped repository only when clean status and a fresh base diff
  prove no changes. Dirty/changed/unreadable context refuses publication; actual
  affected targets still require original executed receipt/accepted takeover,
  original branch/open PR/current scope and provider guards. No receipt is invented.
- **R146-ROOT-2 = Task146R1-STANDARDS-S1:** a restored resource queue could block
  the holder of its needed capacity. Restored and gracefully paused queued claims
  now expose `admissionReady:false`, retained `waitCreditMs` and an execution-wait
  reason. They do not contend until actual execution admission. Acquired claims
  reactivate earned wait credit; capacity/downtime while parked adds no resource
  aging. Active, draining, held-expansion and unconfirmed external owners remain
  exclusive. Machine capacity and its age policy are unchanged.

The repair changes only these two product owners. Current prompt/capability
contracts already require actual targets and capacity before resource admission;
no new capability or prompt is introduced. Entire prompt/expected fixtures and
native/human/impact/provider quality gates remain untouched. Reservation docs and
the existing changelog entry are updated, with the actual PR183 link.

### Current affected runtime/mock integration

`ReservationRecovery.test.ts` is the one small affected integration family allowed
by the repair request. Public workflow validation, actual WorkflowRuntime,
FactoryTools/receipt ownership, normal shutdown/restoration/resumeAll and real
SessionSemaphore(1) execute. Git/provider commands are controlled; this is not a
fresh authenticated API F1 drive or real Git/provider/native enforcement proof.
No validator or authority guard is mocked; checkpoints/run ages/claims/history
are not patched. Runtime homes and optional receipt outputs use own TMPDIR.

Five publication cells: single and grouped one-affected/one-unchanged both complete
initial and continued publication, each with one PR creation/two affected pushes.
Changed/dirty/unreadable unreceipted context fails safely with **zero context
add/commit/push effects** and one original PR creation. The affected repository can
already have received its valid continued push before a later context refusal;
this does not claim whole-provider transaction atomicity or erase partial effects.

The restart cell first creates a genuine queued resource claim while holding the
single capacity slot, with an older run waiting for capacity. Normal shutdown
preserves that wait. A new runtime's resumeAll lets the capacity-admitted operation
run while the older resource claim stays parked. Both intensive runs complete once;
all three restored tool visits complete, peak conflicting mutations **1**, final
capacity active0/waiting0. A separate fake-clock assertion proves earned credit is
reactivated without accruing the parked interval. No sleeps or production timing
claim. Raw compact receipts and exact input hashes are in the summary's `repair`.

### Frozen checks, failures and reuse

Own artifact root: `/tmp/taskbot146-repair-qyl4wr2i`. Current actual Node24.21.0 and
pnpm10.33.1; no installs/dependency builds needed. Source/harness remained frozen
during each check. Only the legacy restart test expectation changed after the
19-case run; those19 inputs and both product owners remain byte-identical.

Commands used the retained own checkout explicitly. Final runs set private HOME,
TMPDIR and CLAUDE_CONFIG_DIR under that artifact root, and invoke
`node packages/edge-worker/node_modules/vitest/vitest.mjs run --config
<own>/focused.config.mjs` with these filters:

- DeliveryFairness + ReservationRecovery: **exit0,19 passed**. Current13 fairness
  plus6 affected runtime integration cases, including genuine restart, groups,
  missing affected authority, dirty context and unreadable base.
- ReservationBoundaries + DeliveryCoordination, selection `original publication
  authority|after shutdown|three affected repositories|releases merge ownership
  between`: **exit1,4 passed/1 failed/30 skipped**. The four positives retain their
  current scope; the old fixed restart publication order was the failure.
- DeliveryCoordination, `ineligible claims block admission`, first revised order:
  **exit1,1 failed/25 skipped**. Reversing a fixed order also failed because either
  leaf may become execution-ready first as startup disk commits settle.
- Final corrected restart selection: **exit0,1 passed/25 skipped**. It retains
  queuedAt/parked-credit assertions, both publication visits exactly once,
  completed runs, cancellation and original capture-count assertions. Only the
  unsupported pre-eligibility order assertion changes; fairness among ready
  contenders and conflict exclusion remain separately exercised.
- `./node_modules/.bin/tsgo -p <own>/owner-typecheck.json --noEmit`: **exit0**,
  scoped source/import graph; not a monorepo check.

Before product repair the first six-cell command was **exit1,2 passed/4 failed**:
unchanged grouped publication and actual restart reproduced the two review defects.
One changed-context fixture introduced changes during initial publication and hit
provider identity rejection; it was corrected to change only at continuation.
The unreadable-base expectation encountered the old missing-authority guard first.
These are not four unique product defects. After the two product edits and fixture
correction, the six cells passed (exit0), then the final19 passed. Initial two
commands isolated runtime TMPDIR/Claude but retained the existing tooling HOME;
final current checks use the private HOME. No native or credential-store call ran.

No single all-final-file suite claim: prior independent22 are scoped reuse where
owners/mechanisms remain unchanged; current13 fairness +2 continuation recheck
changed owners. Other7 original boundary cases, full prompts/429 frozen entries
and head/native/impact guards retain report2550's exact limits. Original F1 BASE
prepared-publication versus candidate merge distinction remains historical00cf
proof, not final repair-source certification. Earlier failures, cosmetic Biome1,
143 three BASE failures,144 timeout/STOP/EOF and145 partial-matrix qualifications
remain unchanged. No broad/full/native/CI replay or cosmetic cleanup.

### Outcome and compatibility disposition

Both confirmed failure paths have repair evidence; parent must run NEW exact-head
whole-diff Standards+Spec review. No self-clearance/status/approval/merge supplied.
All146 criteria retain their earlier disposition with the two failed compositions
now exercised by the affected integration: local concurrency/publication split,
capacity-ready acquisition/cleanup, shared QA exclusion, completion/continuous
aging, current head/base/context/QA/findings/native human/provider prerequisites,
atomic grouped/nested/stale/cancel/restart safety, conservative legacy capability
reasons and truthful ownership/wait state.126 tracking/outbox and109 passive CI are
unchanged;94/132/145 original approval and cumulative continuation remain required.

All eight epic decisions remain: forkability except Simple; generic configured
agents/Check/flow/human/actions; library/custom schemas; declarative safe views;
targeted Ask/reconsolidation; composed Improve/no old routine; inherited research
worker; foundation-first sequence. No UI,147/148, active-run edit or deployment.
DoD: same ready PR183, linked ticket, actual changelog/capability contracts and
focused runtime integration; parent acceptance/squash pending. Development CI is
skipped; integrated post148 broad/full/native validation remains deferred, not passed.
