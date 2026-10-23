# For each recipes

`foreach` runs the same body for a bounded, accepted collection of items. It is a
generic recipe container: its behavior comes from its configuration, not its ID.
Use it for perspectives, assignments, or any other JSON collection. Existing
Parallel (`fanout`) and Call recipe (`workflow`) definitions keep their conventions.

## Source, body, and settings

This recipe takes an agent's `items` array, inspects every item, then lets a Check
consume the keyed results and failure summary:

```json
{
  "id": "inspect-items",
  "name": "Inspect items",
  "stepConfigVersion": "step-config-v1",
  "steps": [
    {
      "id": "source",
      "name": "Choose items",
      "type": "agent",
      "prompt": "Return an items array with a stable string id and name for every item.",
      "output": { "format": "json-v1" },
      "next": "batch"
    },
    {
      "id": "batch",
      "name": "Inspect each item",
      "type": "foreach",
      "items": { "from": "/source/items" },
      "itemId": "/id",
      "concurrency": 4,
      "maxItems": 100,
      "failure": "keep-successful",
      "body": [
        {
          "id": "inspect",
          "name": "Inspect item",
          "type": "agent",
          "reads": { "current": "@item", "position": "@index" },
          "prompt": "Inspect current. Return the finding as JSON.",
          "output": { "format": "json-v1" },
          "next": "end"
        }
      ],
      "next": "verify"
    },
    {
      "id": "verify",
      "name": "Check the batch",
      "type": "check",
      "reads": { "batch": "batch" },
      "check": {
        "results": {
          "allCompleted": { "path": "/inputs/batch/summary/failed", "equals": 0 },
          "results": { "select": "/inputs/batch/results" },
          "limitations": { "select": "/inputs/batch/summary/limitations" }
        },
        "passed": { "path": "/results/allCompleted", "equals": true }
      },
      "next": "end"
    }
  ]
}
```

Alternatively, set `items` to an inline JSON list:

```json
{ "values": [{ "id": "security", "name": "Security" }, { "id": "operations", "name": "Operations" }] }
```

| Setting | Default | Accepted values |
| --- | --- | --- |
| `items` | Required | Exactly one of `{ "from": "/earlier-output/path" }` or `{ "values": [...] }` |
| `body` | Required | 1–100 ordinary recipe steps with local `next` and branch destinations |
| `itemId` | `/id` | Safe JSON Pointer relative to each item; `""` selects the whole item, useful for string item lists |
| `concurrency` | `4` | Integer from 1 to 32 |
| `maxItems` | `100` | Integer from 1 to 1000 |
| `failure` | `all-must-succeed` | `all-must-succeed` or `keep-successful` |

The item ID must be a unique string of 1–80 ASCII letters, digits, `_`, or `-`.
Missing IDs, numeric IDs, duplicates and the reserved names `__proto__`,
`constructor` and `prototype` are rejected. Identity never falls back to the array
index. An item's accepted zero-based index remains available for presentation.

Pointers use JSON Pointer escaping (`~0` for `~`, `~1` for `/`), own properties,
and no wildcards or expression evaluation. `items.from` is relative to the current
graph's ordinary outputs; `/inputs` exposes this step's declared named reads.
Within an iteration, `/item` and `/index` refer to its lexical frame. Missing
segments and non-array sources fail clearly before any item is dispatched.

Before dispatch, the runtime validates and durably snapshots the complete item
list, its original order, IDs, body, input outputs and settings. It never truncates
a collection to fit `maxItems`. The snapshot must be plain, acyclic JSON without
accessors (including hidden ones), serialization hooks, symbol/non-enumerable
properties, sparse arrays, extra array properties, unsafe property names, or
nonfinite numbers. Complete own descriptors and exact plain/null prototypes are
checked before parsing; size measurement uses a sanitized copy without input
hooks. Every array position must be an own data property. The snapshot is
bounded to 1 MiB of UTF-8 JSON, depth 32 and 100,000 visited values, with an
additional one-million-character preflight bound. An empty list completes with
empty results and zero counts.

## Call recipe and nested For each

A Call recipe step can be the entire body. Its `inputMapping` maps named call
inputs to safe JSON Pointers in the caller's current graph scope:

```json
{
  "id": "batch",
  "name": "Research each assignment",
  "type": "foreach",
  "items": { "from": "/coordinate/assignments" },
  "body": [
    {
      "id": "research",
      "name": "Call assignment research",
      "type": "workflow",
      "workflow": "research-assignment",
      "inputMapping": { "topic": "/item/name", "assignment": "/item", "ordinal": "/index" },
      "next": "end"
    }
  ],
  "next": "end"
}
```

The called recipe must allow the `workflow` launch trigger. Its agents declare
reads such as `{ "topic": "@callInputs/topic" }`; Checks read that alias through
`/inputs/topic`. There are at most 30 mapping names, each starting with a letter
and containing at most 60 letters, digits, `_`, or `-`. Reserved lexical and unsafe
names are rejected. Call inputs are separate from ordinary output names and
retain their accepted values across continuation.

`inputMapping` also works on top-level Call recipe steps. Its pointer root is the
current graph's own ordinary outputs, with `/inputs` for the Call step's declared
named reads. `/item` and `/index` are available when that Call is inside an
iteration. The called graph reads mappings through `@callInputs`; it does not
need to infer call inputs from an ordinary output with the same name.

The called graph retains the caller's current `/item` and `/index`. A nested
For each establishes a new lexical item and index for its own body. Mapping an
outer item into `@callInputs` preserves that outer context while the inner frame
changes. Siblings receive separate snapshots and output maps; child output writes
do not mutate a parent's accepted inputs. Human-question agents and human decision
tools are rejected transitively through inline bodies, nested Parallel/For each,
and called recipes. Call cycles and the existing ten-level graph depth limit
remain rejected.

## Output and activity

Each successful item contributes only outputs actually produced in its own body
frame under the accepted item ID. Ancestor outputs remain available for declared
reads, but an unexecuted child never publishes an inherited value merely because
the names match. Persisted frame receipts establish result membership through
restart; mapped Calls and generic Parallel inside these new scopes follow the
same rule. Legacy shared Calls and Parallel outside these scopes keep their
existing conventions. If persisted child ownership cannot be verified, execution
stops with an explicit error and retains the original evidence; it does not replay
completed work to manufacture proof. Results and failure records follow accepted
item order, independently of completion timing. For example:

```json
{
  "results": {
    "security": { "inspect": { "finding": "No issue found" } }
  },
  "summary": {
    "total": 2,
    "completed": 1,
    "failed": 1,
    "cancelled": 0,
    "failures": [{ "id": "operations", "index": 1, "status": "failed", "error": "Provider unavailable" }],
    "limitations": ["operations: Provider unavailable"]
  }
}
```

The called body shape is
`results.<itemId>.<callId>.outputs.<calledStepId>`, with the ordinary Call receipt's
`workflow` and `completed` fields. A nested loop appears at its normal body step
name and has its own `results` and `summary`. Later agents and Checks use named
reads of this output, as with Parallel outputs. Runtime history keeps exact keys
such as `batch/security/inspect`; calls and nesting extend that full frame path.
This preserves the item and producer authority for evidence and native sessions.

Run activity exposes each item's pending, running, completed, failed or cancelled
status and the actual completed/failed/total counts. The Recipes container shows
the real body, source and concurrency; its settings panel edits those fields and
validates them on save. Simulation resolves the accepted source with the same
production preparation and aggregation logic, then applies selectable synthetic
per-item pass, failure or visit-limit outcomes and the configured failure policy.
It does not execute nested/called rules or native body steps. Production-runtime
tests and the F1 drive cover those execution paths. Simulated results are planning
evidence, not native-agent receipts.

## Failure, cancellation, capacity and restart

`all-must-succeed` stops dispatch after an item fails, aborts active siblings,
waits for their cleanup and fails the container. Completed original item receipts
remain retained. Failed/cancelled item progress is visible, and later steps do
not receive a successful aggregate. `keep-successful` allows remaining items to
settle and returns successful outputs together with every explicit failure and
limitation. A downstream Check decides whether those limitations are acceptable;
the policy never converts a failure into a successful item.

A body that reaches its terminal destination with a `failed` or `blocked` status
fails the item, including terminal statuses propagated through Call recipe and
Parallel. An explicit correction route may handle a failure within the body and
reach a successful final destination. Retry keeps the failed item's own native
session and preserves completed sibling items.

The configured concurrency bounds active item bodies. Every native agent or
compute-intensive leaf also receives real `MachineCapacity` admission; nested
orchestration containers retain no parent slot or shared-resource reservation
while waiting for children. Thus a loop configured for four items may run fewer
when the instance has fewer available slots. Each child's normal step visit budget
is persisted in its own frame, including calls and nested loops. For each adds no
new generic convergence policy or extra visit allowance.

Each item has a durable child checkpoint. A completed item is skipped after
restart. Unfinished items continue their exact retained graph/native-agent
checkpoint, and accepted source order, IDs, settings and body remain frozen even
if later recipe settings or source outputs change. A completed child can be
joined after restart without repeating its completed leaves. Explicit cancellation
preserves unfinished context for the existing Resume path and cannot publish a
successful partial aggregate. Native continuations can require another provider
turn; retained logical work is not evidence that no new native turn occurred.

These guarantees use the existing action/native checkpoint boundaries. They do
not promise exactly-once arbitrary external side effects across a crash between
the effect and its durable receipt. Existing action-specific reconciliation and
recovery safeguards still apply. Frozen accepted recipes and old runs retain
their saved definitions; editing a recipe affects new launches.
