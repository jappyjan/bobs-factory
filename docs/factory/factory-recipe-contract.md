# Factory and Takeover on nodes: sub-recipe contract

Epic #156 rebuilds Factory and Takeover as `engineVersion: "nodes-v1"` compositions of
sub-recipes built only from generic nodes (see `nodes.md` and `display.md`). The C tickets
build the sub-recipes in parallel; D1 composes them and deletes the legacy graph. This
file is the contract between them. Change it in the same PR as any recipe that needs a
different shape.

## Transition rules

- New sub-recipes are bundled `internal` recipes with `engineVersion: "nodes-v1"` and ids
  prefixed `v2-`. The legacy `factory`, `takeover` and their sub-recipes keep running
  unchanged until D1 swaps the composition.
- A C ticket deletes legacy code only when nothing still references it. D1 removes the
  rest.
- Every sub-recipe declares `inputs` (only the ports it reads) and `outcomes`, can be
  launched standalone (`allowedTriggers: ["workflow", "manual"]`), and has a mocked
  end-to-end test of its own.
- No engine, node or web code may be added for a particular recipe. Missing generic
  capability goes into the node (with docs), never into a step-name branch.
- Prompts keep the substance of today's stock prompts (`stockFactorySteps.ts`,
  `InstructionLibrary.ts`). Byte-identical prompts are not required.

## Shared launch context

Every sub-recipe may read `@source` (the launch prompt and fields) and `@ticket` (the
originating ticket, when there is one). Nothing else is implicit.

In `nodes-v1`, `@source` is `{ prompt, fields, source? }`: the original run input,
accepted launch fields, and optional launch source label. Unmarked legacy recipes
retain their original Takeover-specific `@source` meaning.

### C1 output locations

The three C1 recipes also collect their public ports on a Transform named
`output` for standalone/API consumers. Call `bindings` must name actual producer
steps, not properties inside an output. Bind the ports to these flat producers:

- `requirements`: `<planning-call>/decisions`
- `plan`: `<planning-call>/plan`
- `architecture`: `<check-in-call>/result`
- `change`: `<implementation-call>/change`
- `pr`: `<implementation-call>/pr`

Read `outcome` on the Call before consuming completed ports. Standalone launches
accept the declared ports as JSON launch fields. `inputMapping` can alternatively
select properties from a Call result envelope as ordinary data.

`v2-check-in` snapshots its incoming `plan` port in the local `plan-input` Transform
before each proposal. Its display binds `plan-input` and `architecture`: this binds
the complete plan even for standalone data inputs that have no caller receipt.
The snapshot's declared read still detects changes to the incoming plan. Prior
review and human feedback is captured before drafting, so the next answer cannot
invalidate the proposal's own feedback read. Every human acceptance checks
`fresh("acceptance")` before completing. Once a human has responded, a routine
reclassification still goes through independent review and fresh human acceptance.

On `revise-plan`, `output.architecture` has `accepted: false` and `planChanges`
containing the complete proposed plan. This is revision input for the caller,
not an accepted replacement for the `plan` port. `v2-clarify-plan` accepts optional
`requirements` and `architecture` inputs for this return route; its agents read
the prior requirements, proposed plan changes and human feedback before replanning.
Initially routine work returns `meaningful: false, accepted: false`. On `to-architecture`, implementation returns
before publishing; completed `change` and `pr` ports are available only after the
Git and PR nodes finish. The implementer supplies a separate PR `title` capped at
100 characters; the complete plan summary remains available for publication text.

## Ports

Calls bind ports by name. The producing sub-recipe's output step must emit the shape
below. Extra fields are allowed; listed fields are required unless marked optional.

| Port | Producer | Shape |
| --- | --- | --- |
| `requirements` | `v2-clarify-plan`, `v2-takeover-intake` | `{ summary, requirements: [{ id, text, source? }], decisions: [{ id, question, answer }], outOfScope: [string] }` |
| `plan` | `v2-clarify-plan`, `v2-takeover-intake` (revised by `v2-check-in`) | `{ summary, deliveryMode: "repository"\|"external"\|"mixed"\|"deferred", steps: [{ id, text, requirementRefs }], risks: [string], repositories: [id] }` |
| `architecture` | `v2-check-in` | `{ meaningful, accepted, decisions: [{ id, text }], approval?: <display output> }` |
| `change` | `v2-implementation`, any fixer | `{ summary, repositories: [{ id, head }] }` (git commit/push outputs) |
| `pr` | `v2-implementation` | the `pr ensure` output (`{ repositories: [{ id, head, url, isDraft }] }`) |
| `review` | `v2-review-loop` | `{ approved, findings: [{ id, rating, status, title, requirementRefs, reviewer }], coverage: [{ requirementId, status }] }` |
| `qa` | `v2-qa` | `{ needed, passed, scenarios: [{ id, title }], evidence: [{ scenarioId, kind: "screenshot"\|"video", path }] }` |
| `approval` | `v2-approval` | the selected stamped `explicit` or `carried` authorization receipt (see below); display answer fields plus `{ authorization, approvedRepositories, repositories, carriedFrom, decision }` |
| `merge` | `v2-merge` | the `merge` output |
| `delivery` | `v2-external` | `{ applied, verified, ticketUrl }` |

## Outcomes and composition loops

| Sub-recipe | Outcomes |
| --- | --- |
| `v2-clarify-plan` | `completed` |
| `v2-check-in` | `completed`, `revise-plan` |
| `v2-implementation` | `completed`, `to-architecture` |
| `v2-review-loop` | `completed`, `to-architecture`, `to-ci` |
| `v2-qa` | `completed`, `to-review` |
| `v2-ci` | `completed`, `to-review` |
| `v2-approval` | `completed`, `to-review`, `to-ci` |
| `v2-merge` | `completed`, `to-review`, `to-ci` |
| `v2-external` | `completed`, `revise-plan` |
| `v2-takeover-intake` | `completed` (also emits `requirements` and `plan`, so Takeover can skip clarify/plan) |

D1 composes Factory as: clarify-plan → `check` on `plan.deliveryMode` → (check-in →
implementation → review-loop → ci → qa → approval → merge) and/or external. Takeover:
takeover-intake → the same blocks. Composition-level `check` nodes route outcomes back
(`to-review` → review-loop, `to-ci` → ci, `to-architecture` / `revise-plan` →
check-in / clarify-plan).

## Human interaction

Every human screen is a `display` node. Agents that need answers emit
`{ status: "needs-input", display: <document> }`. A `check` routes to
`display(from: <agent>/display)`, and the agent continues with `session: "resume"`.
Approvals `bind` what they approve, and any gate after a human approval checks
`fresh(<approval>)`.

## C2: `v2-review-loop`

The standalone recipe reads exactly `requirements`, `plan`, and `pr`, plus the
shared `@source`/`@ticket` context. It reuses the accepted `requirements` port as
its ID inventory instead of extracting a second competing source of scope.
Incomplete or changed scope goes to `to-architecture` for clarification/check-in;
reviewers cannot silently amend requirements or accept scope waivers.

A pure `review-inputs` transform first retains the accepted ports under an
executed producer, so nested reviewer freshness works for standalone launch inputs
as well as bound Call ports. The graph observes HEAD → assesses impact → runs the six specialists in Parallel
→ tags and retains a finding ledger → fills coverage gaps → checks approval.
A rejection observes convergence over HEAD and open finding IDs. Two unchanged
observations show a `display` asking for corrective direction, architecture
revision, or CI readiness. Continue resumes the fixer; a fixer can also emit a
needs-input display. Fixes publish through Git commit (`hooks: false`), push and
PR ensure, then return to impact assessment. Architecture and readiness exits
also produce the `review` output with `approved: false`.

Each reviewer uses `session: "resume"`, `reuse: "unchanged-inputs"`, and
`revisionScope: {paths: {from: "/inputs/area/paths"}}`. Impact emits one stable
`{paths, corrections}` entry per specialist. Paths must cover all relevant shared
dependencies/configuration; uncertainty requires the whole repository (`":/"`).
The reviewer reads only its own entry and the accepted requirements/plan. Ledger,
HEAD and human answers are deliberately outside those reads: unrelated commits
and other reviewers' findings must not defeat scoped reuse. The final check also
requires every specialist receipt to remain fresh and completed. Native sessions
and engine receipts own restart/reuse; no review-specific runtime state is used.

The `review` step emits the required port plus `ledger`, `outcome`, `pr` (the latest
PR ensure receipt, or the original input) and `change` (the latest push receipt,
or null). D1 can bind `call/outputs/review` and its updated `pr` field. Outcomes
are `completed`, `to-architecture`, and `to-ci`. A readiness-only assessment cannot
bypass a previously rejected review; human routing preserves unresolved findings
in the output and never changes their dispositions.

Finding IDs are globally stable `<specialist-id>:<local-id>` values. The transform
keeps omitted complaints, settled findings and disagreements in the ledger; only
an evidence-backed reviewer disposition settles them. Fixer dispositions are
claims for reassessment. Unsupported reopening retains the prior settlement;
reopening requires fresh evidence. Nitpicks (rating 1) stay visible in the ledger
but do not block. Exact duplicate IDs collapse; cross-reviewer aliases suppress
an actionable duplicate only when the original is independently actionable and
requirement references, evidence and remedy match. Unproven/cyclic aliases remain
independent blockers. Contradictory recommendations are `kind: "disagreement"`
findings with the same retention and settlement rules.

Coverage has one row per accepted requirement, with a missing row becoming
`not_met`. A deliberate skip additionally requires a matching accepted decision
with `kind: "skip"`, `requirementRefs` containing that requirement, a nonblank
`answer`, and a nonblank source reference (`source`). These are optional extra
fields on the shared decisions port; ordinary decisions do not authorize skips.

Legacy `review-loop`, `SpecialistReview.ts`, `Impact.ts`, `ReviewRecovery.ts`,
`specialistSteps.ts`, stock review prompts/check adapters and `run.reviewGate`
remain referenced by the legacy Factory and saved definitions. D1 owns their
removal after replacing the composition. C2 removes none of that active code.

## Takeover intake (C5)

`v2-takeover-intake` declares optional call inputs `pr` (the repository IO request
binding: `{url}` for one repository or `{repositories:[{id,url}]}`) and `ticket`
(a verified `TicketReference`). Standalone launches keep Takeover's existing
`source` and `prompt` field names. Ticket identifiers/URLs use the host's normal
source resolution, yielding `@ticket` and the run's verified ticket reference;
PR/MR URLs can be read directly from the launch `source` field, and an explicit
`pr` call input takes precedence. In nodes-v1, `@source` is the shared launch
context envelope above; prepared request data must be passed through the `pr` port.
The host/caller owns selecting the existing worktree/branch; this read-only
recipe does not switch branches, draft a request or grant delivery authority.

The recipe reads the request and/or ticket when available, Git status and the
merge-base-to-head diff. A request's observed per-repository base SHA binds the
comparison; missing base objects are fetched from `origin` without changing the
worktree. Ticket-only launches use the scoped repository base. All assessment dependencies
are declared statically. `assess-existing` emits the shared `requirements` and
`plan` shapes above plus `completed`, `remaining`, `risks` and `assets` string
arrays. The terminal `result` step emits `{requirements, plan}`; callers bind
`<call>/outputs/result/requirements` and `<call>/outputs/result/plan`. Its sole
outcome is `completed`. The plan preserves completed work and describes only
remaining steps, including unresolved feedback and validation.

## QA and approval composition (C3)

`v2-qa` ends at its `qa` output step. It scopes observable demonstrations, skips
with `{needed:false,passed:true,scenarios:[],evidence:[]}` when none are needed,
then runs capture per stable scenario ID. A scenario contains its accepted
expectations, fixture/environment identity and all source/configuration pathspecs.
Each capture reads that complete scenario and a retry marker; `revisionScope` uses
its paths. Failed captures and scenarios named by review findings always recapture,
even without source changes. An uncertain dependency uses `:(glob)**`; a changing
external environment must change the scenario fingerprint. Reuse preserves original evidence; unrelated
commits do not force independent scenarios to execute again. Capture verifies real
media and repository file evidence. Review resolves scenario IDs and inspects actual
playback. Failed review routes through a resumed fixer, commit and push, then back
to capture. Three cycles with the same affected scenarios and capture pass/fail
state pause at a human Display; retry never grants QA acceptance. A successful
correction returns `to-review` so D1 repeats the code review and CI gates before approval; an uncorrected pass returns `completed`.
Video is ordinary scenario/capture policy, with no engine flag.

`v2-approval` ends at its `approval` output step. It pushes, reads provider state,
checks clean worktrees, fresh accepted review and QA receipts, and current
successful provider checks. Review/QA problems return `to-review`; provider/head/CI problems return
`to-ci`. The freely composed guide uses output format `display`, with verified
code references and the brief-v3 show & tell / Dig deeper substance in its prompt.
It marks the request ready, then presents the guide with Approve, Request changes
and optional item/code-note comments. The display binds both `guide` and `published`, the provider-verified current
`pr` receipt (rather than trusting standalone launch JSON as a stamped producer). Only Approve plus `fresh(approval-display)` creates an explicit receipt;
rejection or a new head goes through a resumed fixer, commit/push and `to-review`.
No legacy recipe has been switched over.

### Approval carry-forward and the merge gate

Repeated calls **at the same call site** retain the original `explicit` approval and the latest human gate result. On a
later visit, an impact agent compares the cumulative diff from the original
`approvedRepositories` heads to the current provider heads. A previous carried
decision does not reset this comparison point. Small safe production fixes are
eligible; meaningful changes, weakened tests, unknown dependencies or uncertainty
require a new human decision. A later human rejection or stale-answer failure disables carry-forward until a new explicit approval succeeds.
The impact decision cannot replace review, QA or required provider checks.

The exported approval keeps the display answer fields and adds:

- `authorization: "explicit" | "carried"`, selecting this visit's receipt;
- `approvedRepositories`, the original explicitly human-approved heads;
- `repositories`, the currently authorized provider heads;
- `carriedFrom` and `decision` (null on an explicit decision), retaining the
  earlier approval and the independently evidenced cumulative-impact assessment.

The actual authorization producers are `explicit` (binds `approval-display`) and
`carried` (binds `impact`, `published` and `checks`). Both contain the current
authorized repository heads in their stamped receipt. The `approval` projection
selects this visit's exit for presentation;
**the projection is data, not consent**.

D1 inspects the call's projected `authorization` to select the actual producer and
binds that producer directly as C4's `approval` port: for example,
`bindings: { approval: "approval/explicit", pr: "implementation/pr" }`, or
`approval: "approval/carried"` after carry-forward. D1 owns those composition
paths. C4 remains reusable with exactly two inputs, `approval` and `pr`, and never
knows a sibling call-site path. Copied JSON, manual launch data and the presentation
projection do not replace the authorization receipt.

C4's gate checks `approval.action == "approve" && fresh("approval")`. When the
receipt has non-null `carriedFrom`, it additionally requires
`authorization == "carried"`, `decision.safe == true` and empty
`decision.uncertainty`. `merge` with `expectedRevision: "approval"` takes each
expected provider head from that actual bound receipt. Recheck provider requirements
at merge: local `fresh()` does not detect remote-only pushes. Never use the old
`carriedFrom` head as the expected merge head. A refused carry-forward regenerates
the guide with a short cumulative delta and the human's requests first.

D1 still owns deletion of the legacy QA/approval graphs and stock roles, `Qa`,
`QaReuse`, video-contract adapters, `ReviewBrief`, `Guide*`, `NativeViews` and
specialized web `review-*` presentation paths where no other legacy/custom recipe
needs them. C3 deletes none: the legacy Factory/Takeover compositions still use them.
