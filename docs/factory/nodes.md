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
`flow`, `io`; effects are `pure`, `agent`, `human`, `effect`, `flow`. They describe
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
