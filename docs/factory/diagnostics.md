# Run timing and bounded diagnostics

The Working row and run screen label **age**, **execution**, **wait** and
**unobserved** separately. An old run is not evidence of continuous execution.
The current operation identifies its actual wait category, resource and blocking
run. The expanded screen uses the ordinary declarative table components.

Accounting observes existing execution/admission/resource boundaries; it does not
schedule work, alter fairness credit, grant Continue, or approve evidence. Accepted
recipe definitions, original attempt/visit reasons, build/contract/instruction
identities, human decisions, native conversations and original evidence stay owned
by their existing mechanisms. It does not change context access or transcript
allowances; outputs-first restrictions belong to the later follow-up.

## Time semantics

- Execution is the union of observed executing leaves. Call, Parallel and For each
  container lifetimes do not add another execution interval.
- Exclusive wait is the union of observed waits while no leaf executes. Per-reason
  totals are separate unions and **can overlap** other waits and execution. Do not
  sum them to infer run wall time.
- Agent role wall is separately labeled: the sum of observed actual agent turns,
  including concurrent roles. Multiple observations of one attempt count once.
  Generic capacity leases (including transport/discovery/setup) can contribute
  execution but never imply an agent turn. Simple records its own runner boundary.
  This is not provider inference time or CPU time.
- Capacity admission, repository publication, shared QA resources, provider CI,
  human decisions, child-run waits and transport retry/backoff have explicit
  categories. Preparation/recovery without a proven execution boundary is unknown.
- A monotonic clock measures intervals within one runtime. State boundaries and a
  five-second heartbeat checkpoint a small sidecar. An observation contributes at
  most five seconds: a suspended process/event loop cannot invent execution for an
  unobserved interval. Current-state duration is measured time in that observation
  interval, not an inferred uninterrupted wall interval.
- Restart retains aggregates and closes previous active observations at the last
  persisted boundary, with an interruption receipt. Downtime is never execution
  or diagnostic wait credit. Admission fairness retains its separate existing
  policy; diagnostic accounting never reads queue timestamps as elapsed credit.
  Restored capacity leaves are scheduling records only. A fresh process-local
  callback establishes execution or eligible capacity waiting; parked requests do
  not add measured wait. Saved scheduling state and previous totals are retained.
- Grouped repository/QA ownership stays atomic. Wait categories come from every
  actual blocking target intersection, not the reservation name. A combined claim
  may contribute to both per-reason unions while exclusive wait counts once;
  changing blockers starts/ends the corresponding observed intervals.
- Age uses wall time since creation. Unobserved is the nonnegative remainder after
  execution/exclusive wait, including old history, offline gaps, preparation and
  time after the last observation. Clock changes are counted; wall age can differ
  from monotonic totals. No historical interval or identity is backfilled.

## Retention and retrieval

`<factoryHome>/factory/diagnostics/<run-id>.json` retains aggregates, current
operations and the latest 64 transitions/attempt summaries/reuse links/reported
usage records. It is additive diagnostic state, never a canonical execution or
approval receipt. The observation start identifies the coverage window. Heartbeats
write this small sidecar rather than serializing a complete run.

`GET /api/runs/:id/diagnostics?offset=0&limit=20` is protected by the normal Factory
API boundary. The positive limit caps at 32; pagination covers the retained recent
window, not a hidden full history. Current operations cap at 32 with `currentTotal`;
recent role/check counts describe the retained window. Stable full step hashes and
original attempt IDs distinguish long nested identities despite bounded display
labels. The endpoint reads only diagnostic data, not saved outputs or history.
The same bounded JSON is downloadable from the run screen. No credentials, raw
prompts, configuration dumps or full evidence bodies are included. Resource names
are shown only for simple declared IDs; opaque repository/path scopes use stable
kind/hash identities and a blocking run ID.

Each successful context `list_context`/`read_context` response records one page and
its UTF-8 JSON payload bytes, excluding MCP transport duplication. Read/list/full
page counts include repeated reads, aliases, readiness probes and reconnects;
failed reads add no delivered page. Each connection writes a constant-size private
counter receipt. The owning role checkpoints deltas and captures the final counters
before cleaning its snapshot; unflushed pre-crash retrievals are not inferred.
Snapshot preparation count/time is separate. Existing UTF-16 pagination offsets,
immutable roots and complete scoped evidence retrieval remain unchanged.

Usage shows only attributable provider-reported fields. Missing token/cost values
are null/unknown. Non-Claude adapters synthesize compatibility zeros, so only
nonzero token totals are attributable there; synthesized zero costs remain unknown.
Per-result token values are not summed across native resumes, whose reported totals
may be cumulative. No prices, savings or inference duration are estimated.
