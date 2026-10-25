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

## Agent nodes (new engine)

Set `engineVersion: "nodes-v1"` on a recipe to opt into the node engine contract.
Absence retains accepted legacy definitions, including `step-config-v1` recipes;
that older marker alone does **not** opt in. The marker belongs to each definition,
including called recipes, and is retained when saving or forking. No existing
recipe is migrated automatically. This marker is shared with the other #156 node
work; align it with B3 if that contract changes before integration.

An agent runs a prompt and returns data. Its configuration is:

```json
{
  "id": "compose",
  "type": "agent",
  "name": "Compose",
  "prompt": "Produce the requested result from the supplied reads.",
  "reads": { "request": "@launchInputs/request", "answer": "human/answer" },
  "output": { "schema": { "type": "object", "required": ["status"] } },
  "rules": [],
  "verify": [{ "check": "files-exist", "path": "/files/*" }],
  "access": "workspace",
  "instructions": [],
  "session": "resume",
  "runner": "codex",
  "model": "configured-model",
  "chat": false,
  "next": "status"
}
```

`output` accepts `{ "format": "<registered format ID>" }` or `{ "schema": <JSON
Schema> }`. Runner/model settings also include `reasoningEffort`, `modelVariant`
and `serviceTier`, subject to the selected runner's existing support. Graph routes,
visit limits, resource constraints and context policies retain their usual meaning.

`session` defaults to `fresh`: each graph visit starts a new native conversation.
`resume` retains the node's last native session in its lexical graph frame and
continues it when a loop revisits that node. The next message contains the newly
resolved named reads (bounded values inline, large or native-transcript reads
through scoped factory-context references); the factory-context connection is rebuilt with current data.
Separate nodes, calls and item frames keep separate session identities. An
interrupted visit and output-correction retries continue their saved session in
either mode; `fresh` controls **new visits**, not recovery within a visit.
Session identities survive checkpoints and cold restarts. A resumed visit never
reuses its previous completed result as the new output.

All currently selectable runners support native resume: Claude uses SDK `resume`,
Codex resumes its app-server thread, Gemini uses `-r`, Cursor resumes its agent,
and OpenCode uses `--session`. Native errors propagate through the existing
recovery path; they do not silently start a fresh conversation. A different runner
cannot consume another runner's session ID. A revisited `resume` node with no
retained native ID fails with an explicit error; select `fresh` when the runner
cannot retain a resumable session.

`verify` accepts only selector-based generic evidence checks:

- `{"check":"files-exist","path":"/files/*","repositoryId":"optional-repo"}`
- `{"check":"media-valid","path":"/images/*","kind":"image"}` (or `video`)
- `{"check":"code-refs-valid","path":"/references/*","repositoryId":"optional-repo"}`
- `{"check":"ids-resolve","path":"/selected/*","source":"items","ids":"/items/*/id"}`

Selectors are JSON Pointers with `*` for array/object entries. `source` names a
read on this agent. File and code checks retain repository containment/revision
validation; media checks retain the evidence-directory boundary. Verification
failures use the existing bounded output-correction retries in the same native
session, with the rejected output and precise issues. Schemas and declarative
rules express other output requirements. Runtime contract adapters are unavailable
through `verify`.

New-engine agents reject `qaContract`, `videoContract`, `impactContract`, `impact`,
`architectureSource`, `architectureContract`, `architectureBrief`, `reviewContract`,
`guideContract`, `review`, `impactSource`, `inputs`, `askQuestions`, `view` and
`checks`, including inside nested graphs. Legacy definitions and their prompt
assembly remain unchanged. The new builder panel exposes Session and Verify and
leaves human presentation to separate nodes.

## Asking a human through graph composition

An agent can return ordinary data such as:

```json
{ "status": "needs-input", "display": { "title": "Choose a value" } }
```

The recipe owns the loop:

```text
agent (session: resume)
  → check(status == needs-input)
      true → display(from: agent/display) → agent
      false → next node
```

Bind the display's answer output into the agent's `reads`. The returning message
contains that new read; the existing native conversation provides continuity.
The agent neither renders UI nor waits for answers itself. Output field names
such as `status` and `display` have no special engine meaning. The display document
must match the display node's configured schema.

`test/fixtures/agent-node-needs-input.json` is an executable test recipe. Until B2
lands, `test/AgentNode.test.ts` registers a tiny pure status check and fake human
node through the registry. It tests the complete loop and a restart while waiting,
without introducing another production human UI protocol.
