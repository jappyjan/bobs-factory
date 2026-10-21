# Improve codebase

**Status: bundled manual workflow (`improve-codebase`).**

Before first launch, choose a cheaper model under **Recipes → Improve codebase → Cheaper research worker**. Research workers never silently inherit the main model. The selected repository is required; a task prompt is not.

Find the largest worthwhile improvements to a repository's architecture,
organization and operating model. A lead coordinates several research
coordinators, each delegating evidence collection to cheaper-model subagents.
Combine their perspectives into a short proposal, refine it with the user, then
launch ordinary Software factory runs for the approved work. Research, planning
and independent implementation work run concurrently where their inputs permit.

## Launch experience

- **Name:** Improve codebase
- **Workflow ID:** `improve-codebase`
- **Description:** Find the biggest opportunities to improve this repository's
  architecture, structure and reliability. Review the proposals with Bob, choose
  what to improve, then let the Factory tackle independent improvements in parallel.
- **Required task input:** none. Use the repository selected in the normal
  launcher; no ticket, problem statement or prompt is required.
- **Optional field:** `focus`, labelled **Area of focus**, with the placeholder
  “For example: authentication, slow tests, repository routing, or confusing modules”.
- **Initial trigger:** manual. Calling this workflow from another workflow can
  be added later with explicit repository scope and the same human decision gate.

An empty focus starts discovery immediately. Bob reads the repository instructions,
domain documentation and recent history to decide where to look. An explicit
focus directs discovery; related callers and dependencies remain in scope for
understanding it. Bob explains any proposed expansion before it is selected.

## Parallel research hierarchy

The lead prepares shared context once: repository instructions, domain vocabulary,
relevant ADRs, a map of the repository, pinned source revision, optional focus and
available operational evidence. Each perspective below is owned by a
**coordinator**, which breaks its question into bounded research assignments for
**cheaper-model subagents**. Coordinators plan the investigation, verify important
evidence and synthesize conclusions; subagents do the bulk of repository and
data inspection. They do not each repeat the same whole-repository audit.

```text
Lead
  ├─ Change-history coordinator ─────── cheaper research subagents
  ├─ System-architecture coordinator ─ cheaper research subagents
  ├─ Security-architecture coordinator cheaper research subagents
  ├─ Repository-structure coordinator  cheaper research subagents
  ├─ Engineering-patterns coordinator  cheaper research subagents
  ├─ Verification-design coordinator   cheaper research subagents
  ├─ Reliability-design coordinator    cheaper research subagents
  └─ Operational-evidence coordinator  cheaper research subagents, when applicable
                       ↓
             One consolidated proposal
```

| Perspective | Coordinator's research brief |
| --- | --- |
| Recent change patterns | Examine the last X period for hotspots, repeated cross-module changes, responsibility drift and areas where new work keeps spreading across unrelated paths. Default X to 30 days, configurable in workflow settings. Churn locates questions; it does not prove poor design. |
| Overall system architecture | Examine the current repository, including quieter areas: major flows, module interfaces, state and lifecycle ownership, dependency direction, duplicated concepts and architectural constraints. |
| Security architecture | Examine trust and authority boundaries, identity, isolation, sensitive-data flows and how security policy is enforced across the system. Prioritize systemic exposure and inconsistent ownership. |
| Repository structure and modularity | Examine whether files, folders and packages reflect responsibilities; whether a concept is easy to find and change; and whether coupling, cycles or layering make work unnecessarily spread out. File size and naming alone are insufficient findings. |
| Engineering patterns and standards | Compare major architectural patterns with repository guidance and established practice: configuration, errors, persistence, integrations and ownership of shared concerns. Identify consequential inconsistencies or missing guardrails, rather than style violations. |
| Verification architecture | Examine test seams, integration coverage, fixture/environment ownership and feedback speed. Find architectural obstacles to verifying important behaviour, rather than collecting missing assertions. |
| Reliability and scalability design | Examine failure domains, recovery, retries, resource ownership, concurrency and shared state. Connect design choices to meaningful failure or growth risks, using measurements where available. |
| Operational evidence, when applicable | Analyse relevant historical/live data, logs, traces or run histories for recurring error patterns, stalls, retry loops and recovery failures. Correlate observed patterns with the source and architecture. |

All coordinators receive the same focus and source baseline but keep independent
briefs. The current-state perspective remains broader than recent history so
longstanding structural problems are not excluded by a quiet month. A focus
narrows each brief; an inapplicable perspective records why it was skipped.

Model settings distinguish lead/coordinator work from cheaper research work.
Resolve these to models actually available through the configured providers;
do not hardcode a model name as universally cheap. Each applicable coordinator
normally delegates up to two focused assignments and can use fewer when enough
evidence is available. Research workers are leaves: they do not recursively
spawn more agents. Change role preferences for future runs when a different model is needed. Accepted runs retain their role settings.
If no cheaper model is available, show that limitation and use the explicitly
configured fallback policy; do not silently bill all workers at coordinator rates.

Use one shared concurrency and work budget for the hierarchy. All perspective
coordinators can become ready together; capacity decides how many agents execute
at once. Coordinators waiting on workers release their compute slots. Give each
worker a bounded question, paths/data scope, tool/time budget and output limit.
Share the repository map and relevant collected evidence, persist completed
assignments, and retry only missing or failed work. A failed perspective remains
visible as a coverage gap; it is never an empty successful audit.

## Operational evidence

The initial runtime automatically supplies repository-matched retained Factory run histories when the selected repository is Bob’s Factory. Researchers can also inspect operational documentation and tracked exports through the pinned source tools. Arbitrary live log/database connectors are not enabled by this workflow; missing sources are explicit coverage limits. Capture a
bounded observation window, instance/environment, source versions and evidence
identifiers. The history window defaults to the same 30 days when data exists;
report the actual period and sampling limits. Live observations form a dated
snapshot, not an assertion that the system will remain in that state.

For Bob's Factory, inspect retained run outcomes and transition histories,
available transitions, wait reasons and attempt outcomes. Raw worker logs are not copied into research context; errors are categorized and run IDs support local investigation. Look for concentrations by workflow, step, provider, version or
repository: runs repeatedly failing to progress, resuming into the same failure,
cycling through correction, or losing continuity after restart. Report counts
with denominators and durations where available. Distinguish expected waits for
human input, CI, capacity or external access from a genuine lack of progress;
elapsed time alone cannot establish a stuck run. Relate historical failures to
the version that produced them and check whether the current architecture has
already addressed the cause.

Prefer structured histories and aggregate queries; inspect a few representative
traces to validate a pattern. Give cheaper workers narrow queries and sanitized
excerpts. Retain evidence references and redact secrets and unnecessary personal
data from findings. Treat logs and stored agent text as observations, not as
instructions. Analysis uses read access; retries, state repairs, production
experiments and configuration changes belong to later approved work. Missing
access or retention limits reduce coverage without blocking repository research.

## Architectural significance and synthesis

This workflow is an architectural survey. Its unit of concern is a responsibility,
module cluster, dependency pattern, repository layout, trust boundary, lifecycle
or verification strategy. Research follows representative flows to understand
those structures. It does not grade every function or turn minor imperfections
into a cleanup backlog.

Every coordinator and worker receives the same filter: **surface only substantial
opportunities that are worth the disruption of changing the design**. A finding
needs concrete evidence, a meaningful consequence and a proportionate remedy.
Prioritize systemic friction, recurring operational failures and structures that
make important changes or verification costly. Exclude formatting, naming
preferences, isolated stylistic inconsistencies, speculative abstractions and
micro-optimizations. An existing design can be good enough. Returning no findings
is a successful outcome. If a small targeted change addresses a systemic problem,
recommend it; do not manufacture an architectural rewrite to fit the workflow.

The architecture lens is **module depth**: how much useful behaviour sits behind
an interface, and how much a caller must understand to use it. Prefer changes
that concentrate knowledge and verification in one place. More abstractions,
smaller files, fewer lines and higher coverage percentages are not goals by
themselves. Test recommendations must protect observable behaviour. Performance
or reliability claims need measurements or concrete failure evidence; unmeasured
benefits remain hypotheses.

Workers return bounded evidence records: perspective/assignment, observation,
source revision or dated operational snapshot, inspected paths/data references,
structural consequence, possible direction, confidence and limitations. Each
coordinator checks the strongest evidence and returns at most two or three
substantial opportunities, or none. Agreement between agents is not independent
proof; preserve their original evidence and any conflicting interpretations.

The lead consolidates overlapping findings across perspectives, resolves material
contradictions with targeted follow-up research, and ranks by consequence,
confidence, reach, expected benefit and cost/risk of change. One structural
problem becomes one candidate with several evidence sources, rather than one
candidate per researcher. There are no per-perspective quotas or synthetic
numerical quality scores.

Present the strongest three candidates first, expanding to at most five when
there are clearly distinct substantial opportunities. This is a ceiling for
attention, not a quota: zero worthwhile findings is valid. Retain supporting
research and coverage gaps behind the shortlist. Discovery and discussion can
write run-owned proposal artifacts, but do not edit repository files, publish PRs
or create external tickets.

Each proposal item contains:

| Field | What the user sees |
| --- | --- |
| Identity | Stable item ID and a plain title describing the improvement |
| Evidence | Exact repository revision, relevant paths, dated operational evidence when used, and contributing perspectives |
| Why now | Maintenance cost, change frequency or observed failure that makes it worthwhile |
| Before and after | A short explanation and diagram of how responsibilities and calls would change |
| Plan | Ordered implementation steps, expected file operations and migration needs |
| Acceptance | Observable outcomes, relevant checks, and tests to retain, replace or add |
| Limits | Non-goals, compatibility requirements, risks, tradeoffs and open questions |
| Recommendation | Strong, worth exploring or speculative, with reasoning and rough effort |
| Relationships | Prerequisite item IDs, mutually exclusive alternatives, likely shared edits and resources |

Offer a top recommendation and explain it. The first pass proposes a direction
and enough detail to assess it; refine exact interfaces and implementation plans
for candidates the user wants to pursue. Existing design decisions can be
challenged when there is new evidence, with the conflict and tradeoff visible.

## Discussion and selection

Show the shortlist in the existing proposal reader with expandable evidence and
plans. Support comments on the overall proposal and on individual item IDs. Use
discussion-driven revision: Bob incorporates feedback and publishes a new
version, with a short account of what changed. A collaborative document editor
is unnecessary.

Each item starts **Undecided** and offers four explicit actions:

| Action | Outcome |
| --- | --- |
| **Fix** | Include this improvement in the implementation batch. |
| **File issue** | Create a self-contained issue in the chosen configured tracker/project, retaining the finding and plan for later. Do not implement it now. |
| **Ignore** | Exclude it from implementation and issue creation; retain the decision and any reason in this run. |
| **Ask follow-up** | Ask for explanation, alternatives or additional targeted research; return with an answer and revised proposal before deciding. |

Choices and item comments persist across reload. Explanations and positive
comments do not select an action or authorize execution. A follow-up remains
unresolved until its response is available and the user chooses Fix, File issue
or Ignore; asking a question never silently becomes Fix. Ignored items retain
the user's reason in this run; writing a lasting ADR is a separate requested
deliverable. Changed plans require a renewed choice for that item.

Selecting an item marks the user's intent; it does not launch work. Before the
final decision, Bob refines selected candidates into self-contained work packages
in parallel. Package authors use the consolidated evidence and shared decisions;
the lead reconciles shared interfaces and dependencies before freezing a candidate
manifest. The independent checks of architectural value/scope, security/operational
impact, and dependency/validation completeness can then run in parallel against
that same manifest. These are plan checks for consequential gaps, using the same
big-improvements filter. They do not introduce a code-review or perfection gate.
Changed packages invalidate affected checks; unaffected receipts remain linked
to the manifest they inspected. Concrete corrections return to the proposal loop.
Automated review never supplies human acceptance.

The final review shows exactly which packages will become Factory runs, how items
map to them, which can start together and which must wait. Closely coupled items
can become one package; an item can become several packages when each has an
independent outcome. Both changes are visible before acceptance. Choosing Fix
for an item whose prerequisite is marked File issue, Ignore or Undecided flags
the dependency. The user must choose Fix for that prerequisite, revise the
dependent plan, or move that item out of the implementation batch. Filing an
issue does not satisfy an implementation dependency.

The primary action is **Apply choices**, with a clear preview such as **Start 2
Factory runs and file 3 issues**. Show immediate and queued run counts separately.
It explicitly accepts the displayed action manifest before creating any issue
or child run. Disable it while required follow-ups/choices are open, dependencies
are missing, alternatives conflict, issue destinations are unresolved, or
independent review has unresolved corrections. An issue-only batch and an
all-Ignore batch are valid. Undecided items remain outside the accepted actions.
The user can also choose **Finish without changes**; retain proposals and decisions.

Acceptance binds the exact proposal version, per-item actions, issue destinations
and contents, complete package plans and dependency graph to a runtime-owned
digest, actor and time.
Changing a selected plan, its package allocation or dependencies requires fresh
review and acceptance of the affected execution manifest. Earlier decisions and
proposal versions remain readable. Historical views cannot accept a newer plan.

## Standard Factory execution

Only **Fix** items create **independent Factory runs**, each using workflow `factory`. Each package
supplies the accepted goal, evidence, full plan, acceptance criteria, non-goals,
repository/base, prerequisite outcomes and assets. The child should be able to
work from that brief without reconstructing the parent conversation.

Each child owns its worktree, native conversation, execution snapshot, checkpoints,
review evidence and PR. Keep the ordinary Factory clarification, planning,
architecture, implementation, verification, specialist review, QA, human review
and delivery rules. Pass established decisions as context so children do not
needlessly ask the same questions. Parent acceptance authorizes the selected work
and run creation; it does not impersonate child architecture acceptance, approve
a delivered PR revision or authorize a merge. Material discoveries return through
the appropriate existing approval path.

Launch every ready independent package subject to the instance's configured
capacity. No new launch-time concurrency field is required. Separate worktrees
do not prove independence: inspect shared interfaces, lockfiles, migrations,
generated outputs, tests and external resources. Combine tightly coupled work or
declare ordering; preserve Factory delivery and shared QA coordination.

For a dependency A → B, the default release condition is **A delivered and its
accepted outcome verified**. Prepare B from the target branch containing that
confirmed delivery, then revalidate its accepted assumptions. A completed agent
turn or an open PR is insufficient. Parallel siblings use ordinary base-update,
CI and review rules as other changes land. Material scope drift waits for renewed
acceptance; routine compatible base movement follows existing Factory rules.
The first version does not introduce stacked PR delivery.

The parent shows a live list of packages, run links, PR links and outcomes. Keep
**Launched** separate from **Delivered**. A child awaiting human review remains
visible as such. A failed or stopped child blocks its dependants while unrelated
children can continue. Parent waiting releases compute capacity and does not
hold repository delivery or QA reservations.

## Recovery and control

For **File issue**, retain the destination and complete issue payload before
dispatch: problem, evidence references, expected benefit, proposed plan, acceptance
criteria, non-goals and prerequisites. Retain returned issue IDs/URLs and stable
creation identities. Reconcile uncertain outcomes through the provider's
idempotency support or an exact retained marker before retrying; do not create a
second issue blindly. Keep confirmed issues on partial failure and retry only
unfinished actions. New issues remain unassigned and outside active execution
so tracker intake cannot immediately start work the user deferred. Reuse an
already-linked issue for this exact action instead of creating a duplicate.

Persist the accepted manifest and dispatch intent before creating children. Use
one stable launch identity per parent, accepted manifest digest and package ID.
Child creation must atomically deduplicate that identity and persist the child
with its parent reference before execution can begin. On retry or restart,
reconcile existing children and dispatch only missing ready packages. An uncertain
creation outcome requires reconciliation, never a blind second launch. A retry
cannot start the same improvement twice or replace a retained native conversation.

Stopping the parent stops new dispatch; already launched children continue and
the UI states that consequence. Provide an explicit **Stop batch and active
runs** action when the user intends to stop them too, preserving their work and
receipts. Resume reconciles saved state and workflow availability before scheduling.
Retrying a failed child resumes that child through its standard recovery path.
File issue and Ignore items never become implementation runs on Resume.

After dispatch begins, the accepted manifest is immutable. Additional suggestions
become a separately reviewed batch. Changes to active work use normal child
steering and architecture revision; the parent must show any resulting dependency
block rather than silently rewriting its accepted graph.

Finish when every selected package has a terminal, confirmed outcome. Show
delivered improvements with evidence, created issue links, ignored/undecided
suggestions, failed or stopped work and blocked dependants separately. An issue
action completes only with confirmed issue identity; it is not delivered code.
Report partial completion honestly;
creating child runs alone does not complete the improvement batch. A dependant
whose prerequisite cannot deliver needs a visible stop, deferral or revised-plan
decision before the parent can finish.

## Workflow outline

The outline below explains the runtime stages. It is not an importable recipe; use the bundled workflow or fork it in Recipes. Role prompts and models are normal agent steps; the `improvement` settings select the bounded runtime coordinator.

```yaml
id: improve-codebase
name: Improve codebase
allowedTriggers: [manual]
launchFields:
  - name: focus
    label: Area of focus
    type: textarea
    required: false

research:
  topology: lead -> perspective-coordinators -> cheaper-research-workers
  lookbackDays: 30 # workflow setting, not required task input
  maxWorkersPerCoordinator: 2
  workerDelegationDepth: 0
  concurrencyAndWorkBudget: shared-across-hierarchy
  workerModels: configured-cheaper-tier-with-explicit-fallback-policy
  operationalEvidence: when-relevant-and-accessible-read-only
  perspectives:
    - recent-change-patterns
    - overall-system-architecture
    - security-architecture
    - repository-structure-and-modularity
    - engineering-patterns-and-standards
    - verification-architecture
    - reliability-and-scalability-design
    - operational-evidence
  findingFilter: consequential-structural-opportunities-only
  shortlist: strongest-3-up-to-5-no-minimum

stages:
  - prepare: pin shared source/context and scope; identify available runtime data
  - research: parallel coordinators delegate bounded work to cheaper subagents
  - synthesize: verify, deduplicate and rank substantial architectural opportunities
  - propose: show before/after, evidence, draft plans and acceptance criteria
  - discuss: choose fix, file-issue, ignore or ask-follow-up per item; revise as needed
  - package: refine selected plans in parallel; reconcile interfaces and dependencies
  - review: parallel independent checks of the same candidate manifest
  - accept: human accepts exact action manifest, or finishes without changes
  - dispatch: file issues; create independent factory runs for fix actions only
  - track: reconcile children; release dependants after verified delivery
  - summarize: show confirmed outcomes and remaining suggestions

execution:
  childWorkflow: factory
  isolation: independent-run-and-worktree
  concurrency: instance-capacity
  dependencyRelease: verified-delivery
  retries: reconcile-by-stable-launch-identity
  approval: explicit-human-acceptance-of-exact-manifest
  itemActions: [fix, issue, ignore, follow-up]
  issueCreation: confirmed-and-deduplicated-without-assignment
```

## Runtime and settings

[`improvementWorkflow.ts`](../../packages/edge-worker/src/factory/improvementWorkflow.ts) defines the bundled roles. [`ImprovementRuntime.ts`](../../packages/edge-worker/src/factory/ImprovementRuntime.ts) owns bounded delegation, versioned choices, accepted manifests, issue receipts and independent child launches. Standard nested workflow steps continue to execute within one run; this coordinator explicitly creates independent Factory runs.

Bundled roles expose normal provider/model preferences. To change the structural settings, fork the recipe and edit its `improvement` object:

```json
{
  "lookbackDays": 30,
  "concurrency": 4,
  "maxAgentAttempts": 80,
  "roleTimeoutSeconds": 300,
  "workerFallback": "block"
}
```

The budget bounds role attempts, elapsed time, repository tool calls and concurrency; it is not a currency-denominated billing cap. All work also uses instance capacity. `workerFallback: "inherit"` is an explicit private-fork option; default `block` requires the research-worker model to be configured. Supported research runners are Claude, Codex, Cursor and OpenCode; Gemini research is rejected until its read-only tool contract is supported. Model availability and pricing remain provider configuration responsibilities.

Research tools read only regular tracked blobs at the pinned revision, excluding symlinks and secret-looking paths. Native shell, file-edit and delegation tools are disabled; research gets no external tracker tools. No implementation or issue creation starts before explicit Apply choices. Repository setup creates the ordinary isolated worktree.

Issue filing supports configured Taskbot MCP and native Legacy Linear workspaces. Explicit execution profiles cannot silently borrow native Linear credentials. Deferred issues use backlog state, no Factory assignment, exact creation markers and retained IDs. A lost Taskbot response is reconciled by marker; if no marker is visible, creation stays uncertain instead of issuing a duplicate. Restore/reconcile the original request before retrying. A tracker failure leaves independent Fix runs running and makes the parent retryable.

Children retain ordinary Factory architecture, QA, human revision approval and provider-confirmed merge gates. Failed/stopped children block dependants; open the child to retry or stop the batch. The parent remains incomplete until every required delivery is proven. General stacked delivery and combined multi-PR approval remain separate work described in [the child-delivery ADR](../adr/0001-independent-child-run-delivery.md).

## Validation coverage

1. Launching with no task input starts discovery; a supplied focus reaches the
   survey unchanged. Discovery leaves repository and external systems untouched.
2. Evidence-backed candidates and plans are reviewable; zero findings finishes
   without inventing work. Comments produce retained proposal revisions.
3. Per-item Fix, File issue, Ignore and Ask follow-up choices survive reload. Comments, automated
   approval and stale-version decisions cannot start a child.
4. Missing prerequisites, cycles and conflicting alternatives block acceptance.
   The accepted manifest includes only explicitly chosen work and its visible
   package allocation.
5. Two independent packages become separate standard Factory runs and worktrees,
   runnable concurrently when capacity permits. Each keeps its ordinary gates.
6. A dependent package waits for verified prerequisite delivery and uses a base
   containing it. Failure blocks dependants without blocking independent work.
7. Duplicate submissions, crashes at child creation and restarts preserve exactly
   one child per launch identity. Partial dispatch resumes only missing work.
8. Stop/resume and workflow disabling retain decisions, children and native
   progress. The batch cannot report delivered while a required child awaits
   review, fails, or has unresolved dependants.
9. Applicable perspective coordinators delegate bounded inspection to configured
   cheaper-model workers. The shared capacity/work limits, fallback policy and
   worker-depth limit apply across the hierarchy, including retries.
10. Discovery covers both recent-change patterns and current architecture. It
    consolidates duplicate evidence, retains disagreements/coverage gaps and
    excludes cosmetic or low-value findings without forcing a minimum count.
11. When operational evidence is applicable, the proposal retains the observation
    period, source version, sampling limits and evidence references. A Bob fixture
    distinguishes expected waiting runs from repeated failed recovery/stalls,
    correlates the pattern to architecture and performs no run mutations.
12. Selected plans can be refined concurrently. Parallel plan checks consume the
    same candidate manifest; corrections cannot leave stale approval receipts
    authorizing a changed plan.
13. A mixed batch files issues only for File issue items and launches Factory
    runs only for Fix items. Issue-only and all-Ignore batches are valid; an
    unresolved follow-up cannot launch work. Issue creation preserves confirmed
    links through uncertain responses/restarts and never assigns deferred work
    to the Factory agent. An issue action cannot unblock a Fix dependency.

Validation uses focused runtime/UI tests and a mocked F1 drive covering
the research hierarchy, evidence synthesis, operational-data handling, selection,
dispatch, restart and delivery-dependency behaviours above.

## Inspiration

Matt Pocock's [Tell your agents to CARE about the codebase](https://www.youtube.com/watch?v=9uSygtI-6lw)
argues for explicitly asking agents to consider long-term code quality. Around
1:44 he mentions his architecture improvement skill.
[`improve-codebase-architecture`](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md)
surveys architectural friction, presents visual candidates and develops the
chosen direction through discussion. Its
[`codebase-design`](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md)
vocabulary supplies the module-depth and testability lens.

Batch selection, exact execution acceptance and parallel standard Factory runs
are the Factory-specific extension. The upstream skill is a source
of design ideas; this workflow does not require installing it or an external runtime.
