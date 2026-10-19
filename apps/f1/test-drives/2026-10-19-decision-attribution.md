# Recorded operator decisions without repeated identity questions

Date: 2026-10-19. Base: `061d3a56`. Mode: deterministic mocked agents and
read-only production-record replay. No native inference, live run mutation,
tracker mutation or real merge was performed by the drive.

## Applicability and reproduction

F1 applies to generated Factory role instructions, scoped context and frozen
workflow recovery. The stock extractor required the actual accepting person,
but original answer and architecture/human decision receipts do not record a
personal name. Three of five inspected production runs had already asked for
identity despite retaining the substantive decision. ATT-1145 contained the
exact reported question; its owner had answered and the run had continued.

Before the patch, the focused WorkflowExecution regressions failed because the
runtime context omitted original answers and an honest unnamed attribution.
The schema already permits a nonempty operator attribution; no schema or
historical receipt migration is necessary.

## Drive and assertions

After building workspace dependencies, the edge worker and F1:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/frozen-workflow-approval-context.mjs
```

The maintained driver uses an isolated home/repository, real EdgeWorker, an
explicit shared CLI issue tracker, F1 CLI issue/session/activity commands,
guarded dashboard actions and real scoped MCP `read_context` calls. All agents
are scripted. Sharing the fixture tracker across restart preserves its sessions.

- A legacy workflow is frozen before a newer architecture graph is installed.
  Restart preserves that graph and resumes its implementation conversation.
- Its unnamed answer remains available through `/workflowExecution/answers`,
  including the original timestamp and the separate final-approval boundary.
- Its frozen extraction prompt still demands the actual person. The supplied
  runtime instructions clarify attribution without editing that prompt. The
  scripted extractor records `Factory operator (name not recorded)` with the
  exact original source, no identity question and no unavailable-source conflict.
- A fresh workflow waits for exact-version architecture acceptance. Automated
  review does not unblock it. The guarded decision then appears unchanged in
  scoped context and supports extraction without a name or extra answer.
- Both inventories validate. Neither flow manufactures final human approval.
  Existing specialist tests confirm unnamed attribution still requires an
  explicit skip decision and cannot substitute an ordinary scope decision.

Result: **passed**. Nine role turns, two completed fixture workflows, preserved
native conversation on restart, zero unexpected errors and clean shutdown.
These assertions prove instruction/context wiring and orchestration; scripted
agents do not establish native model interpretation.

## Current-run replay and local verification

Five saved production runs supplied 41 original answer/architecture/human
receipts. Candidate context projection retained every receipt and frozen graph
without changing the inputs or inventing an approval. The ATT-1145 replay
excluded the later identity answer: its six earlier answers and exact version-24
acceptance remained usable with the unnamed attribution. Live runs were left
running; failed runs with unrelated blockers were not retried.

The read-only replay checks data availability and preservation, not whether a
live agent has adopted code that has not been installed. Private run contents
remain outside the repository.

Validation: 173 focused tests passed across WorkflowExecution, SpecialistReview,
WorkflowNativeRecovery, FactoryPipeline, WorkflowCatalog, FactoryExecution,
FactoryProvenance, Architecture and Guide. Edge-worker build/typecheck, F1 build,
Biome and `git diff --check` passed.

Local evidence:

- `/tmp/f1-decision-attribution.log`
- `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/frozen-workflow-context-FADP68/results.json`
- `/tmp/bobs-attribution-replay-results.json`
- `/tmp/bobs-attribution-observations.json`
