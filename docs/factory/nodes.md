# Factory nodes

A node is a registered schema and executor. Recipes own names, prompts, rules,
views and routes. A new node does not require changes to `Workflow.ts`,
`WorkflowRuntime.ts`, `recipe-builder.tsx` or `recipe-canvas.tsx`.

## Add a node

Create a file under `packages/edge-worker/src/factory/nodes/`:

```ts
import { z } from "zod";
import { stepFields } from "./schema.js";
import type { NodeDefinition } from "./NodeDefinition.js";

const schema = z.object({
  ...stepFields,
  type: z.literal("example"),
  separator: z.string().default(" "),
});

export const definition = {
  type: "example",
  schema,
  category: "logic",
  effect: "pure",
  builder: {
    label: "Example",
    icon: "◇",
    paletteGroup: "logic",
    defaults: { separator: " " },
  },
  execute(ctx) {
    return { text: Object.values(ctx.reads).join(ctx.step.separator) };
  },
  summary: () => "Example completed",
} satisfies NodeDefinition<typeof schema>;
```

Import the definition in `nodes/index.ts` and add `nodeRegistry.register(definition)`.
Duplicate types fail immediately. Categories are `agent`, `display`, `logic`,
`flow`, `io`; effects are `pure`, `read-only`, `agent`, `human`, `effect`, `flow`. They describe
nodes; they do not grant permissions or replace existing execution safeguards.

`StepSchema` first applies the existing `ownStepData` preprocessor, then selects
and parses the registered schema on every parse. Nested Foreach/Fanout steps use
that same preprocessed schema. Registration after an earlier parse also works.
`WorkflowStep` retains the existing common fields and accepts registered type
names; the definition's schema infers its executor's specific configuration.

## Execution services

- `ctx.reads`: detached named reads resolved before dispatch, including bindings
  inherited through calls and item scopes. Inline agent stamps use the same reads
  and filtered history actually passed to the agent. `ctx.input` retains the
  existing execution input; `ctx.outputs` is the current lexical output frame.
- `ctx.inputDigest`: the canonical SHA-256 of those resolved reads.
  `ctx.stamp(output)` returns `{ output, inputDigest }`. The engine records that
  receipt in immutable history for **every** completed node, including inline
  agent/script/tool nodes, arrays and scalars. The stamp sits beside the result
  JSON, preserving existing output schemas, routes and evidence digests. Old
  history records without a stamp remain readable.
- `ctx.checkpoint()`, `ctx.log(message)`, `ctx.signal`: durable save, activity
  logging and cancellation. Check the signal before starting work and pass it
  through cancellable IO.
- `ctx.phase("waiting-ci" | "waiting-human", async () => ...)`: publishes a
  capacity-free wait and its provider/human timing observation, checkpoints before
  the callback, and clears/checkpoints the phase when it settles (including errors
  and cancellation). It never acquires a capacity slot. Use it outside leased
  execution and pass `ctx.signal` to cancellable IO inside the callback. Overlapping
  phases or an existing execution capacity leaf are rejected. A passive wait
  leaf retained across a cold restart can be re-entered.
- `ctx.effectKey(name)`: persists a visit identity and derives a durable key from
  run, visit and effect name. Retries/restarts reuse it; another visit gets a new
  identity. Use a distinct name for each operation/repository/item in a visit.
- `ctx.effect(name, input, send, reconcile?)`: checkpoints `sending` before IO,
  retains `uncertain` after a lost response and checkpoints `confirmed` with the
  provider receipt. `send(key)` must use the key for provider idempotency or a
  searchable marker. An interrupted `sending` record is reconciled as uncertain.
  `reconcile(key)` returns the existing receipt, `null` for independently proven
  absence, or `undefined` when the outcome is unknown. Proven absence permits a
  resend with the **same key**, which must also be the provider idempotency token.
  Unknown outcomes or omitted reconciliation block a resend. Cancellation before
  `send` is invoked is checkpointed as `not-sent` and can retry directly; once
  invoked, a thrown error is conservatively uncertain even if it may be
  transient. Changed intent under the same key is rejected. Confirmed receipts
  are reused. These records live in `run.nodeEffects`; existing File issues and
  Launch runs receipts retain their original formats and reconciliation implementations.

Migrated flow/IO nodes additionally use `ctx.frame`, `ctx.workflowId` and
`ctx.engine` for child graphs, frame results and existing integrations.
`ctx.graphChat` carries the enclosing graph chat mode for child dispatch;
`ctx.chat` is the effective local step mode after review and step overrides. Keep
ordinary node logic on the smaller services above. Agent, script and tool still
use the engine's existing capacity/execution boundary. Legacy configured evidence
and recovery protocols remain in their original boundaries or extracted executors;
this refactor does not remove those protocols.

## Builder and browser boundary

The recipe configuration endpoint sends `nodeRegistry.metadata()` as `nodeTypes`.
Only serializable type/category/effect/builder data crosses into the browser.
The palette, default insertion and canvas kind use that catalog. Builder defaults
may use `$id` and `$callable` placeholders. New nodes automatically receive a JSON
configuration panel; deleting optional fields there removes their saved values,
while preserving the node id and type. Optional specialized React panels register
with `registerNodeSettings(key, Component)` in `web/node-step-settings.tsx`; set
`builder.settings` to that key. No server executor is imported into the web bundle.

`nodes/metadata.ts` retains existing built-in labels and insertion templates as a
browser fallback, including the historical “Ask me” tool alias. New nodes supply
their metadata directly in their definition; they do not extend that fallback.
The larger migrated executors load lazily from `nodes/execute/` to avoid existing
module cycles. A new node can keep schema and execution in one file when it has
no cyclic dependencies.

`test/NodeRegistry.test.ts` demonstrates registration, recipe execution, builder
insertion/settings, recursive data-only safety, output stamps and effect recovery
across a cold runtime restart.


## Definition versions and pure Check

New recipe definitions declare **`engineVersion: "nodes-v1"`** on the workflow.
The builder sets this on a new recipe and preserves it on save/export. Omission
means a legacy definition, including when importing an old recipe or forking a
bundled legacy recipe. Do not silently stamp saved or running legacy graphs.
`stepConfigVersion: "step-config-v1"` and per-step `configVersion` are independent
configuration interpretation markers: existing evidence-backed recipes already
use them, so they cannot distinguish the new node contract. Agent node work must
use this same workflow `engineVersion` boundary, rather than repurposing those
markers. `registerWorkflowConfig` treats marked workflows as explicit, including
steps without optional configuration; called workflows own their own version.

In nodes-v1, a Check rejects the `checks` property, **even an empty array**, at
workflow parse/save time, recursively through nested bodies and parallel groups.
An unmarked definition retains existing code-backed evidence checks until D1.
For either version, a Check with no configured checks takes the pure execution
path: only rules-v1 over resolved named reads; no evidence hooks, file checks or
revision inspection inside its executor. Existing named `check.results`, optional
`check.passed`, boolean aggregation and ordinary branches are unchanged. The
structured rule editor remains available; only legacy recipes show the evidence
checks editor. Editable projection does not add `checks` to a marked Check.

```json
{
  "id": "example", "name": "Example", "engineVersion": "nodes-v1",
  "steps": [{
    "id": "check", "name": "Check", "type": "check",
    "reads": {"data": "source"},
    "check": {"results": {"ready": {"path": "/inputs/data/ready", "equals": true}}},
    "branches": [{"when": {"path": "passed", "equals": true}, "next": "end"}]
  }]
}
```

## Transform

`type: "transform"`, category `logic`, effect `pure`. `transform` is an object
whose fields are rules-v1 expressions (`select`, conditions and `aggregate`:
`filter`, `count`, `all`, `any`), scalar literals, `{literal: <JSON>}`, or a map:
`{map: <JSON Pointer>, where?: <condition>, template: <field object>}`. Use
`literal` for objects and arrays, including data resembling an expression.

The initial document is `{inputs: <resolved reads>}`. Inside map, `select` and
conditions read the current item; `$/inputs/...` reads the original document.
Nested maps keep that original root. Map/aggregate must select arrays; missing
or malformed collections fail. No field can read another field from the same
transform; use another Transform when a subsequent calculation needs its result.

```json
{
  "id": "shape", "name": "Shape", "type": "transform",
  "reads": {"items": "source/items", "label": "source/label"},
  "transform": {
    "rows": {
      "map": "/inputs/items",
      "where": {"path": "/enabled", "equals": true},
      "template": {
        "id": {"select": "/id"},
        "label": {"select": "$/inputs/label"},
        "ready": {"path": "/state", "equals": "ready"}
      }
    },
    "count": {"aggregate": "count", "path": "/inputs/items", "where": {"path": "/enabled", "equals": true}},
    "version": 1,
    "metadata": {"literal": {"source": "recipe"}}
  },
  "output": {"schema": {"type": "object", "required": ["rows", "count"]}}
}
```

Output owns detached JSON. Templates have at most 50 fields per object, 12 map
levels, and share the existing rules-v1 total-work, collection and output budgets
across every field/item. Evaluation yields and honors cancellation. Optional
`output: {schema: <JSON Schema>}` uses the existing bounded validator without
coercion/default insertion. Invalid output fails before a history receipt.

The registry supplies palette/defaults and a Transform settings panel for the
template, reads and output schema. Builder simulation uses
`POST /api/workflows/transform/simulate` with `{step, inputs, fallback?}` and
returns `{output, next}` using the production evaluator and normal route matching.
It performs no provider/file IO.

## Wait

`type: "wait"`, category `flow`, effect `flow`. Configure `body` as **one step**,
`interval` and `timeout` in milliseconds, and `until` as a rules-v1 condition.
A single step object is accepted; parsing normalizes it to a one-element body
array so existing registry graph traversals still work. The body must register
`category: "io", effect: "read-only"` and use a registry executor (not the legacy
inline boundary). The `read-only` effect class is an explicit node contract;
`pure`, `agent`, `human`, `effect`, and `flow` bodies are rejected. A node author
must only assign it to IO that does not write provider/repository state. This
metadata is not a security sandbox. Do not wrap old tool nodes on an assumption
that their current action happens to be read-only.

```json
{
  "id": "wait", "name": "Wait", "type": "wait",
  "body": {"id": "poll", "name": "Poll", "type": "registered-read-only-node", "reads": {"target": "source/target"}},
  "interval": 10000, "timeout": 600000,
  "until": {"path": "/output/ready", "equals": true},
  "retry": {"max": 2, "backoff": 1000}, "onError": "handle"
}
```

The body resolves its own reads on each poll. `until` sees
`{output: <last body output>, inputs: <Wait reads>, polls: <attempt count>}`.
The first poll runs immediately. Later polls wait one interval after the previous
poll; the timeout includes IO and offline time. The deadline, next-poll time,
last output, match and poll count checkpoint on the accepted visit and survive a
restart. A restarted, already-expired wait returns the retained output without
polling again. A new graph visit starts a fresh deadline; an execution retry keeps
the same deadline. Providers should honor `ctx.signal`; the deadline also bounds
the wait if a body promise does not settle. It cannot terminate uncooperative IO.

Object output fields are returned with `{timedOut, polls}` added (these two names
are reserved by Wait); scalar/array body output is retained under `output`.
Timeout is an ordinary result for recipe branches, not an exception. Body errors
fail the Wait, allowing the wrapper's retry/onError policy to handle them. The
embedded body cannot carry routes or retry/onError; put those on the Wait.

Wait uses `ctx.phase("waiting-ci", ...)` across polling and sleeping, with no
execution capacity request. There is one progress line per visit and one final
history receipt, never a history record per poll. The registry adds its palette
entry and a panel for body, durations, until and reads. Tests use a fake registered
read-only node, independent of any particular provider integration.

## Retry and onError

All registered node schemas inherit optional common fields:

```json
{
  "retry": {"max": 3, "backoff": 1000},
  "onError": "handle"
}
```

`max` is the number of **additional** execution attempts (0–100); `backoff` is a
fixed delay in milliseconds (0–86,400,000). Retries reuse the accepted visit and
its effect keys. The retry count and next-attempt time survive restart. Backoff
uses a capacity-free phase. Each failure remains in attempt diagnostics; only a
successful execution appends its normal output receipt. Nodes with writes must
still use their idempotency/reconciliation contracts; retry does not make unsafe
writes safe or waive an uncertain effect.

After exhaustion, `onError` routes to a step in the same lexical graph. The
handler declares `reads: {error: "@error"}` (or `@error/message`), then reads
`/inputs/error` from Check/Transform. The value is `{message, kind}`: `kind` is
an explicit string error kind when present, otherwise the error's name, otherwise
`"Error"`. This runtime-owned context is scoped to that graph frame and retains
the last routed error through restart; it is not a producer output. Error routes
must name an actual local step, not `end` or a declared return outcome. Ordinary
visit limits still bound error-route loops.

Without these properties, execution failure behaves as before. Cancellation,
shutdown and update pauses do not retry or enter an error handler. A false Check
result, a timeout result, or a node's ordinary structured business result remains
normal data for branches. Existing special recovery paths retain precedence.
All builder node panels expose the common retry policy and error destination.
