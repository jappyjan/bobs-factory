# Improve codebase

Choose a repository and **Improve codebase** in the manual launcher. **Area of
focus** is optional; a task prompt and separate research-worker model are not
required. Workers inherit the accepted run model unless their agent step configures
one. Research results retain that inheritance as a limitation.

The stock recipe looks for substantial architectural, organizational, security,
verification and reliability opportunities. It preserves the architectural filter:
evidence, meaningful consequence and a proportionate remedy are required; style
nits, speculative abstractions and micro-optimizations do not qualify. Zero findings
is a valid result.

The Recipes canvas is the executed graph:

```text
Snapshot repository + dated run history
→ Map the codebase (callable recipe, one read-only agent)
→ For each of eight perspectives (concurrency 4, keep successful)
    → Research a perspective (callable recipe)
        coordinator (at most two assignments)
        → For each assignment: read-only worker
        → verify evidence
→ Consolidate proposals (callable recipe, zero to five stable item IDs)
→ Decide per item: Fix / File issue / Skip / Ask Bob
    Ask Bob → dedicated targeted follow-up → Consolidate → Decide
→ Check selected prerequisites and alternatives
→ For each Fix: Refine into a plan (callable recipe)
→ Check exact selected plan coverage
→ Parallel architecture / security / dependency reviews
→ Check all approved? (no → Refine with feedback)
→ Approve exact batch (request changes → Decide)
→ Parallel File issues / Launch Factory runs in dependency order, wait=true
→ Finish
```

The perspectives are Recent change patterns, Overall system architecture, Security
architecture, Repository structure, Engineering patterns, Verification architecture,
Reliability and scalability, and Operational evidence. Research uses the same
whole-scope pinned Snapshot and bounded dated history. Failed perspectives or
workers remain explicit limitations; successful work is retained. Workers run
sequentially within each perspective, keeping total research concurrency at four.

Ask Bob is an ordinary per-item action with a question/comment. Submit the decisions
to run only the dedicated follow-up agent for those items. Consolidation receives
the previous shortlist, exact decisions and follow-up results. Mapping and completed
research do not replay. Unchanged problems retain their item IDs across revisions.

Fix requires its prerequisites also be selected for Fix; mutually conflicting
alternatives cannot both be fixed. Each selected item receives a self-contained
plan and dependency IDs. Three independent agents review the exact plan batch.
Rejected checks return their feedback to refinement. Approval shows plans,
criteria, paths, dependencies and actual check results; it binds the current exact
plans, decisions, baseline and configuration. A changed/stale decision requires a
fresh batch. Request changes supplies feedback through Decide and refinement.

The format library checks review-field bounds while the producing agent can
correct its output. Limitations display their complete text as point details.
Plans show complete prose plus separate criteria, dependencies and paths; a full
package may exceed the single body limit without dropping content. Overlong
individual fields are rejected before reaching a human wait, with the original
output retained for correction. The child receives the exact complete canonical
package that was reviewed, including requirements present only in structured
criteria or paths. Legacy data-only formats retain their original schemas.

File issues creates deferred backlog, unassigned work through the configured
Linear or Taskbot destination. Configure the action's destination in a fork if
several destinations are available. An empty issue selection needs no destination.
Launch runs snapshots the selected plans and Factory recipe, retains original
child identities across retry/restart, and waits for their outcomes. A dependent
child starts only after exact human-approved, provider-confirmed prerequisite
merges. A completed child without merge proof leaves its dependents blocked.
Parent Stop pauses dispatch while observing existing children; **Stop batch and
active runs** also cancels the batch and stops its original children.

Every bundled recipe and callable sub-recipe can be forked except **Simple**.
Forking copies and rewrites the full reachable closure, including the Factory
launch target. Edit prompts, inline perspectives, worker models, reads, actions or
routes in that private copy. Map, Research a perspective, Consolidate proposals and
Refine into a plan appear in the callable palette and allow workflow/manual
launches. Root Improve defaults to manual-only; its launch permissions are editable.
Factory and Takeover are forkable with their existing graphs.

The old Improve-specific executor, settings, state, endpoints and screen are
deleted. No old Improve run has been executed and no migration is provided.
Other accepted runs, forks, native conversations, evidence and human decisions
retain their existing contracts. Read-only access retains the generic native
provider permission boundary; unsupported providers fail explicitly without a
fallback. This change does not claim new native-provider capability.

Definitions: [`improvementWorkflow.ts`](../../packages/edge-worker/src/factory/improvementWorkflow.ts).
Shared prompt substance: [`ResearchPrompts.ts`](../../packages/edge-worker/src/factory/ResearchPrompts.ts).
Output shapes: [`ResearchFormats.ts`](../../packages/edge-worker/src/factory/ResearchFormats.ts).
Execution uses the ordinary recipe interpreter and generic actions/views.
