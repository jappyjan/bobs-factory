# Factory nodes

Factory, Takeover and Improve are `engineVersion: "nodes-v1"` recipes composed
of registered generic nodes. Simple keeps its direct native conversation path.
Recipe names, prompts, rules and routes define domain policy; the runtime never
selects behavior by step ID or tool name.

See the [node catalog](node-catalog.md) for every node’s configuration, output and
example, the [capability reference](capabilities.md) for the runtime boundary,
[Display](display.md) for documents and explicit answers, and the
[composition contract](factory-recipe-contract.md) for bundled recipe ports.

## Author a recipe

Every node has `id`, `name`, `type`, optional `next`, `branches` and `maxVisits`.
Branches compare an output JSON path with `equals`; their `next` names a local
step, a declared outcome or `end`. A branch can select a called recipe’s `entry`.
The default route is the next authored step. Reads name lexical producers or
public context: `@source`, `@ticket`, `@launchInputs`, `@callInputs`, `@caller`,
`@item`, `@index`, `@repository`, `@history`, `@transcripts`, `@agentSettings`,
`@media`, `@childRuns`, and `@error`. A read may have a rules-v1 `when` predicate.
`@source` is `{prompt, fields, source?, request?}`; `request` is host-verified.
Copied JSON provides input, never executed evidence or human consent.

Agents return data. To ask a human, route an agent’s `needs-input` result through
a Display, bind the answer as a read, then revisit the agent with `session:resume`.
Agent output schemas, rules and the four selector-based `verify` checks validate
results through bounded correction retries in the same native conversation.
Check and Transform are pure data operations.

## Receipts and freshness

Each completed node stores its unchanged JSON output beside `inputDigest` and a
versioned `guarantee`. The guarantee records lexical reads, repository revisions,
bound producer digests and optional node state. Old unstamped receipts remain
readable but never establish freshness or reuse. Check `fresh("producer")` before
consuming approval or evidence. It recursively validates bound receipts and
compares current named inputs and local repository observations.

`bind:["producer"]` freezes exact producer receipts before execution or a human
wait. A changed source cannot silently renew a pending answer. `fresh()` does not
fetch remote provider state: Merge additionally passes the approved head SHA to
the provider. Remote-only pushes therefore cannot acquire old approval.

`revisionScope` defaults to `repository`, including pure nodes. It can instead
be `{paths:["src/**"]}`, `{paths:{from:"/inputs/area/paths"}}`, or `none` for
input-only computations. Scoped revisions cover tracked/untracked content and
file modes. Explicit bindings remain recursively fresh under every scope.
Unobservable repositories invalidate reuse conservatively. Human waits retain
their own whole-repository observation as well as inherited evidence.

`reuse:"unchanged-inputs"` skips safe nodes only when input digests, repository
scope and bindings remain fresh. Reused receipts retain original identities and
stamps. Converge and nodes reading their own prior state cannot reuse. Calls,
Parallel branches and stable For each item IDs own independent lexical receipts.
Effect nodes record resulting repository revisions after completion; inherited
pre-effect reads do not invalidate the result merely because that effect changed
HEAD. Bind any evidence that must remain fresh across an effect.

## Recovery, admission and effects

Visits persist before dispatch. `retry:{max,backoff}` retains the same effect and
native conversation; backoff is passive. `onError` routes exhausted failures to a
local step reading `@error`. Cancellation and update pauses do not create retries.
Progress budgets, visit limits, resource reservations and execution capacity stay
independent. Passive human/provider waits hold no machine execution slot.

Mutations use `ctx.effect(name,input,send,reconcile)`. The engine saves intent
before sending. A lost response becomes uncertain; reconciliation either finds
the original receipt, independently proves absence before resending with the same
key, or refuses an unknown outcome. Confirmed receipts never resend. Interrupting
an unsent admission remains retryable. Never substitute copied output for a
provider receipt.

Old nonempty graphs without the node-engine marker stop at load with
“Created by an older recipe engine; restart it”. Their frozen JSON, history and
native conversations remain retained. Legacy local forks remain disabled; fork
again from a current bundled recipe. No old graph or receipt is migrated into
new execution. Graphless Simple conversations remain resumable.

## Add a registered node

Create `src/factory/nodes/<type>.ts`, extend `stepFields`, declare category,
effect, serializable builder metadata and an executor, then register its definition
in `nodes/index.ts`. The dynamic StepSchema validates every parse, including nested
bodies. Duplicate types fail. Builder palettes and generic JSON settings use that
same catalog; browser code never imports server executors. Larger executors may
load lazily under `nodes/execute/` to avoid module cycles.

Executors receive detached `ctx.reads`, `ctx.inputDigest`, cancellation, logging,
checkpointing, `ctx.fresh`, revision recording, durable effects and passive wait
phases. Flow nodes additionally receive the lexical frame and engine services.
Metadata describes effects; it grants no filesystem, provider or tool permission.
