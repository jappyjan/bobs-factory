# Independent impact decisions

New stock Factory and Takeover repository pipelines use `impact-v1` to decide what
must run after a correction. The assessment is a configurable agent role, with the
same runner and model settings as other roles. It inspects actual changes and
original evidence. A fixer's summary cannot authorize skipping review.

The first review still covers every configured specialist and every active
requirement. Later assessments can select affected specialists, repository-owned
checks and QA criteria. Unaffected evidence needs an explicit reuse record that
links the original receipt to the assessed snapshot. Execution dates, revisions
and reviewer identities remain original. Failed, blocked, unresolved or unexecuted
receipts cannot substitute for completed coverage.

## Configuration and compatibility

An assessment declares `impactContract: "impact-v1"` and
`impact: { inventory, fanout, maxUnchangedCycles }`. Those references name the
configured inventory and reviewer group in the same workflow frame. Its context
must be complete, its output must be structured JSON, and `askQuestions` must be
true. Other output contracts cannot share this role.

The fanout, its aggregate gate and consuming tools declare the same
`impactSource`. Correction branches return to that assessment. Check execution
uses the `impact-checks` tool. Gate names and specialist identities are configurable;
review associations survive called workflows and restart. Coverage-required groups
still have exactly one `coverage-v1` supplier.

Existing accepted runs keep their saved graphs and conversations. Saved/custom
recipe upgrades use conservative definitions. Operators opt custom workflows in
by declaring the contracts and their correction/assistance routes; adding a role
does not authorize changing delivery or approval policies.

## Evidence and source boundaries

Reviewers declare covered requirements, areas, dependencies and the reason their
boundary is independent. Runtime-owned fingerprints bind that declaration to the
actual source and execution environment. Unknown dependencies, changed shared
configuration, conflicting integration, weakened test assertions or missing
provenance expand validation. A filename, small diff or matching head cannot
establish safe reuse.

Dependencies are relative repository files or `directory/**` boundaries. Context
JSON Pointers belong in finding evidence. Invalid paths and escaping symlinks
enter the author's bounded output correction before a specialist receipt is
stamped, including when a saved native result is resumed.

An inventory's stable IDs and version survive unchanged source criteria. New
requirements require extraction. A new operational answer can preserve the
inventory only through an explicit independent `scopeReuse` assessment bound to
its original source context and digest. That association is retained separately;
the original extraction receipt is not rewritten. Declared JSON Pointer sources
also bind custom named planning outputs.

Behavioral QA reuse requires an original passed criterion, independent QA
acceptance, identical story/criterion definitions and source dependencies, and
unchanged fixture/environment evidence. A declared read-only environment probe is
executed again and its output hash must match. `environmentEvidence.expectedDigest`
is the SHA-256 of trimmed UTF-8 stdout, without JSON quoting. Frozen scopes using
the older JSON-string digest remain supported; saved criterion provenance keeps
its original digest format. Unknown environment identity,
failed/blocked criteria or changed fixtures require execution. Screenshot
acceptance, source boundaries and media integrity remain separate requirements.
Copying an image never establishes behavioral success. The runtime stamps criterion
provenance while finalizing capture output, before saving evidence and generating
review hashes. Gates validate the saved provenance without rewriting it.

Grouped delivery feedback is fingerprinted for every repository, including comments,
threads and reviews. Comment assessments include `repositoryId` with the provider
comment ID, or use `repositoryId:commentId`. Saved assessments retain that scoped
identity so identical IDs in different repositories cannot suppress new feedback.

Selected checks execute in their selected repositories. They use capacity admission
and retain each completed check result before another check starts. Checks can
declare independent worktree environments or stable shared-resource identities.
Unknown isolation keeps repository-scoped shared QA protection. Completed checks
and selected review branches are retained on recovery; changed state invalidates
an assessment before a consuming gate can use it.

When that assessment is stale, its consuming step returns automatically to the
declared assessor in the same accepted workflow frame. Completed work and original
receipts remain retained; required gates run again. Existing pass and convergence
limits still apply. A legacy failed checkpoint uses the same route on Retry.

## Target advancement and approval

The task baseline, last automated review and current delivery target remain
separate. Assessment creates a combined Git merge tree without changing the
worktree. Unrelated target changes can preserve proven independent coverage.
Overlap with reviewed interfaces, real conflicts or unavailable combined-tree
proof require integration or investigation. Provider-required updates and checks
remain required. Target-only changes are not automatically defects introduced by
the task.

A prior explicit human approval may continue for an independently assessed safe
minor cumulative correction, including production code. All required checks,
review and QA must pass first. A separate continuation receipt binds the original
human decision to the current delivery revisions; it does not invent another
human approval. Every changed repository URL/head must remain covered. Changed
mixed-delivery external evidence requires renewed acceptance. No prior approval,
human rejection, meaningful or uncertain changes, consequential disagreement,
failed checks or stale continuation evidence cannot authorize a merge. Fresh
provider readiness, SHA-guarded merge and confirmed delivery remain mandatory.

## Findings and convergence

Blocking findings need a concrete consequence, accepted requirement or mandatory
rule, evidence, remedy and investigation state. Optional cleanup and optional
disagreements stay visible without blocking. Demonstrated duplicates retain all
original identities and evidence while presenting one actionable issue. Settled
findings need changed evidence before reopening.

A duplicate claim suppresses an actionable item only when its original finding,
requirement IDs, concrete evidence and remedy match. Missing, cyclic or mismatched
aliases remain independent actionable findings; the raw receipt retains the claim.

A code gate can track a declared future QA, guide, acceptance or delivery obligation
without treating that future receipt as an implementation defect. Deferral never
waives the requirement; executable QA, guide readiness, human acceptance and
provider-confirmed delivery enforce their own obligations.

This stage contract also applies to saved conservative specialist reviews, without
opting their graphs into impact assessment or evidence reuse. Runtime instructions
require extraction to declare the stage from accepted sources and retained gates.
Unstaged requirements default to code; mixed criteria need a traceable inventory
amendment that preserves historical IDs, decisions and superseded records. Coverage
can defer only to the exact declared later stage, with evidence and a required
action. Code defects and missing code verification remain blocking. Original
receipts, accepted graphs and native conversations are preserved.

The unchanged-state limit defaults to three and is configurable from two to twenty.
Progress uses source trees, actionable states and valid evidence, not new commit
IDs, receipt timestamps or wording changes. Returning to a recent state also
counts, which bounds alternating demands. Informational assessments and passive
waits do not consume the correction budget. Exhaustion enters assistance with work
and evidence retained; it cannot approve or merge. Assistance releases capacity and
coordination reservations.

The inspector shows selected work, reuse reasons, original execution details and
the human approval outcome. Follow-up guides retain the complete original feature
coverage and describe cumulative corrections and remaining risks.

The chapter reader carries reviewed checkboxes into a renewed guide only when
the chapter, linked requirements and linked system map are identical. Across
revisions it also requires a current independent impact decision with a validated
reuse boundary covering that chapter. Changed chapters and missing, uncertain or
stale reuse evidence clear their reading progress. An explicit unchecked choice
survives reloads. Page position, feedback drafts and approval stay scoped to the
current guide and every repository revision. Saved chapter progress is validated
before restoration, and changes to secondary repositories reset uncertain
progress even when the primary revision and guide are unchanged. Reading
progress never grants approval.
The protected dashboard supplies the single adjacent retained guide needed to
migrate legacy revision-scoped reading progress. Migration still requires current
independent reuse evidence; an absent original guide clears uncertain progress.
Normal navigation aborts the live connection and protected requests when page
exit begins and again on page hide. Late failures from those canceled requests
cannot trigger private-state cleanup in the next document. Actual connection or
access loss still clears private state. Returning through the browser's page
cache reconnects the live stream and checks access again.
