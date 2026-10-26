# Logic and flow nodes (#160)

Date: 2026-10-26. Validated implementation: `8cb934eaf1da847b7f2ef538a4de914c395c666b`
(after fetch/rebase against origin/main), repeated successfully with the
per-operation/access effect resolver follow-up in this PR. Mode: mocked agent and registered fake
read-only provider; real EdgeWorker, Factory runtime, HTTP APIs and disk saves.
No production account/ticket mutation or live model calls.

```sh
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/logic-flow-nodes.ts
```

F1 applies to the changed runtime dispatch, waiting, restart and activity paths.
The drive creates a disposable Git repository and isolated Factory home, starts
the real worker and saves a nodes-v1 recipe. It checks JSON-only registry palette
metadata and executes the production HTTP Transform simulation. A manual HTTP
launch then maps/filter/counts a fixture collection and evaluates a pure Check.

The follow-up fixture defaults its operation to `read`, classified as `pure`
through serializable `operationEffects`, with a conservative `effect` default.
The first read-only poll checkpoints without a history receipt or capacity
request. The worker is stopped and recreated against the same home. The retained
Wait completes on poll two with one final history receipt and one progress line.
A failing node exhausts two additional retries and routes its message/kind through
`@error` into a Transform handler. The mocked final agent response is recorded and
retrievable through the activity API. A second manual launch times out with one
poll, retaining the last provider output. Both runs complete; the worker stops and
the successful fixture is removed.

Result: **PASS**. First run
`manual-8d8a2f03-c55c-469d-ab87-16ff5d2a32ff`; timeout run
`manual-249405dd-808a-46bd-a4c2-ecd9eb0ae211`. Completed history:
`seed → shape → check → wait → handle → finish`.

Focused automated tests additionally compare the persisted deadline and last
output after cold reconstruction, cover expiry while offline, cancellation,
output schema validation, transform work limits and input ownership, legacy/new
Check parsing, retry budget/backoff reconstruction, and server-rendered builder
panels. This drive establishes deterministic engine/HTTP behavior with mocked
inputs; it does not validate a live provider or a native coding-agent integration.


## Independent-review follow-up

Validated implementation: `b979df73913fba705ad23e455c86debc272bf4d2`.
The same mocked command above passes against this committed code. The drive still
uses a disposable repository/home, a real EdgeWorker, HTTP routes and disk saves;
all agents and provider effects remain mocked. The final evidence-only commit
adds this section without changing the tested implementation.

Additional assertions:

- The restarted Wait logs a transient failure on poll two, retains its first
  output and deadline, then succeeds on poll three with one history receipt.
- HTTP Transform simulation flattens keyed reviewer findings, skips a reviewer
  without findings and an absent optional source, retains reviewer keys/indexes,
  deduplicates IDs and finds prior dispositions. A shallow merge applies a
  resolved disposition without dropping the original body/rating; a subsequent
  actionable filter excludes it.
- A simulated uncertain create exhausts automatic retries, sends exactly once,
  keeps one uncertain effect record and its action ID, and never enters the
  handler that would otherwise route back to the sending step.
- A Check correction loop with retry/onError pauses after two unchanged attempts.
  The handler remains unexecuted and no automatic retry is scheduled. An explicit
  HTTP Continue grants exactly one execution before the next convergence pause.
- Successful error handling clears the frame's routed error.

The focused regression checks pass: 271 tests across FactoryLogicFlow (28),
RulesBudget (11), NodeRegistry (12), ProgressBudget (40), WorkflowRuntime (139),
WorkflowCatalog (19), and ActionRuntime (22). These additionally cover 8 reviewers
× 60 findings × 1,200-character bodies, the reported 300/2,000/1,000-item
passthrough cases, in-flight cancellation, parent scopes for nested root reads,
optional failed-poll caps, availability failures inside/outside Wait, retry budget
accounting and effect recovery after restart. Edge-worker typecheck passes.
The implementation pre-commit hook passes lint-staged, workspace build and
workspace typecheck, with lint-staged backup disabled to honor no-stash.
