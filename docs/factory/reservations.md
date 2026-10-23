# Shared mutation reservations

New Factory/Takeover definitions separate local correction from a visible
Push & draft PR action. Generic agent access can opt in with
`{ "mode": "workspace", "publication": "action" }`: the role corrects its own
worktree and runs local checks; the configured action owns branch publication.
This is trusted workflow authority, not a new OS sandbox or shell-command parser.
Follow-up Push & draft PR actions use `arguments.publication: "existing"` and
bind `reads.draftPr` to the original executed publication action (or retain the
accepted takeover source). They verify the original branch and open PR before
push, preserve draft state, and never create a replacement PR from missing receipt
provenance. This includes correction after a PR has already become non-draft.

Declare shared environments through `resources` or the existing QA environment
contract. A separate worktree does not prove separate Docker, databases or fixtures.

Combined push-capable roles retain exclusion for their whole execution, with an
explicit reason. Hooks that cannot prove an execution boundary retain whole-hook
exclusion. Capable runners admit at actual execution after machine capacity is
available and release after attempt cleanup, including failed output retries.
Intensive actions obtain capacity before resource admission. Calls, Parallel and
For each coordinate their concrete leaves rather than holding a parent reservation.
No capacity limit changes.

Trusted access may set `priority: "completion"` for a final delivery action.
It prefers short-wait eligible completions. After 60 seconds of continuous queued
eligibility, FIFO precedes priority. Original run age and timestamps from previous
admissions never confer resource priority. This is opportunity at the next safe
boundary, without interrupting an active mutation or waiving readiness. Admission
still reconciles all affected targets atomically; context-only repositories remain
outside the publication claim. Existing revision, accepted-context, impact,
QA/findings, exact human approval/continuation and native provider checks remain
mandatory inside delivery actions. Passive CI and asynchronous ticket tracking
retain their own bounded supervision/outbox ownership.

Run coordination exposes operation, targets, priority, current waiting time,
readiness, blocker owners and wait reason through existing run summaries/events.
"Active" means reservation ownership, not human/provider approval. Cancellation
retains exclusion while a hook drains; unconfirmed external cancellation retains
unknown ownership until existing capacity reconciliation supplies proof. Interrupted
nested expansion retains its original mutation targets through outer cleanup;
cyclic expansion fails safely rather than deadlocking or speculatively releasing.
Queued waits survive restart only for retained unfinished leaves; old active
admissions start fresh. Original receipts and native conversations stay retained.

Saved workflows and accepted runs are never rewritten. Adopt the new boundaries
by saving a new workflow copy and starting a new run. Existing forks retain their
accepted access, graph, prompts and approval policy; no production upgrade is
performed by this change.
