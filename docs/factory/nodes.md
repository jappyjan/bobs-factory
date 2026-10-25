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

## Agent nodes (new engine)

Set `engineVersion: "nodes-v1"` on a recipe to opt into the node engine contract.
Absence retains accepted legacy definitions, including `step-config-v1` recipes;
that older marker alone does **not** opt in. The marker belongs to each definition,
including called recipes, and is retained when saving or forking. New recipes created in the builder use this marker. No existing
recipe is migrated automatically. This marker is shared by all new-engine nodes, including Check and Transform.

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
`resume` retains the node's last native session by its structural path and
continues it when a loop revisits that node or its enclosing Parallel, For each
or called recipe. The next message contains the newly
resolved named reads (bounded values inline, large or native-transcript reads
through scoped factory-context references); the factory-context connection is rebuilt with current data.
Separate nodes, call sites, Parallel branches and For each item IDs keep separate
session identities, even when child frames are rebuilt. Reordering items keeps
each session with its item ID. An
interrupted visit and output-correction retries continue their saved session in
either mode; `fresh` controls **new visits**, not recovery within a visit.
Session identities survive checkpoints and cold restarts. A resumed visit never
reuses its previous completed result as the new output.

All currently selectable runners support native resume: Claude uses SDK `resume`,
Codex resumes its app-server thread, Gemini uses `-r`, Cursor resumes its agent,
and OpenCode uses `--session`. Resume uses the runner and model saved with the
conversation, even if repository defaults have changed. If the native ID,
transcript or runner is unavailable, the runtime logs a warning and makes one
fresh attempt with the prior output and current reads in the new message
(large prior outputs remain on scoped factory-context access). Other native
errors retain the existing recovery behavior. Dependency refreshes respect
`fresh` versus `resume`; correction retries within the same visit retain their
conversation.

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

## Definition versions and pure Check

New recipe definitions declare **`engineVersion: "nodes-v1"`** on the workflow.
The builder sets this on a new recipe and preserves it on save/export. Omission
means a legacy definition, including when importing an old recipe or forking a
bundled legacy recipe. Do not silently stamp saved or running legacy graphs.
`stepConfigVersion: "step-config-v1"` and per-step `configVersion` are independent
configuration interpretation markers: existing evidence-backed recipes already
use them, so they cannot distinguish the new node contract. Agent nodes use this same workflow `engineVersion` boundary. `registerWorkflowConfig` treats marked workflows as explicit, including
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

Parent pointers (`^/field`, `^@key`) and item metadata (`@key`, `@index`)
are valid only in Transform map item scopes (templates, filters and distinct keys).
Ordinary Check/agent rules and top-level Transform expressions reject them when
the definition is validated. Root pointers (`$/...`) remain available everywhere.

`type: "transform"`, category `logic`, effect `pure`. `transform` is an object
whose fields are rules-v1 expressions (`select`, conditions and `aggregate`:
`filter`, `count`, `all`, `any`), `find`, scalar literals, `{literal: <JSON>}`,
`{merge: [<object expressions>...]}`, or a map:
`{map: <pointer or pointer array>, where?: <condition>, distinctBy?: <pointer>,
missingAsEmpty?: <boolean>, template: <field object>}`. Use
`literal` for objects and arrays, including data resembling an expression.

The initial document is `{inputs: <resolved reads>}`. Inside map, `select` and
conditions read the current item; `$/inputs/...` reads the original document.
Nested maps keep that original root. `^/field` reads the enclosing map or
wildcard item; repeat `^` to climb further. Each `*` adds an item scope, so
`/inputs/reviewers/*/findings/*` retains the reviewer as the finding's parent.
`@key` is the current source key (a string, including array offsets), and `@index`
is its zero-based position before filtering. `^@key` / `^@index` read the parent's
metadata. Object order follows JSON property enumeration order.

Map accepts arrays or keyed objects; an array of source pointers concatenates
collections in declaration order. `missingAsEmpty: true` skips absent/null
collections or branches, including a failed reviewer with no findings. Wrong
scalar types still fail. The default rejects missing collections.
`distinctBy` reads a key from each source item and keeps the first item that
passes `where`, across all sources; missing keys fail. It does not collect duplicates.
Aggregate and `find` collections must select arrays.
`{find: {collection: <pointer>, key: <pointer>, value: <pointer>}}` compares each
collection item's key with the current item's value and returns a detached copy
of the first match, or `null`. Matching uses JSON value equality; a missing sought
value returns `null`. Use `$/inputs/...` for an external collection.
`merge` takes up to 20 rules-v1 expressions or `{literal: <JSON>}` values. It
shallowly combines objects left to right (later fields win), skips `null`
so a missing lookup leaves the original intact, and rejects scalar/array results. No field can read another field from the same
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
levels, and share a separate 20,000,000-unit transform work budget across every
field/item. Rules-v1 retains its 1,000,000-unit budget. Both retain the 20,000-item
collection and 1,000,000-character canonical output limits. Evaluation yields
every 2,048 work units and honors cancellation. Optional
`output: {schema: <JSON Schema>}` uses the existing bounded validator without
coercion/default insertion. Invalid output fails before a history receipt.

For example, given N parallel reviewers under a keyed `reviewers` input (each
value has `name` and `findings`), these two steps flatten findings, retain reviewer
and foreach keys, deduplicate by ID, apply prior disposition fields, then filter
`rating >= 2 && status == open`. A failed reviewer with no findings contributes
nothing. The optional extra source can contain retained findings from a previous
round. The first step retains the complete merged record; the second publishes
the actionable projection. Supply `prior` as `[]` for the first review round.

```json
[
  {
    "id": "aggregate", "name": "Aggregate review", "type": "transform",
    "reads": {
      "reviewers": "parallel-review/results",
      "prior": "prior-review/dispositions",
      "extra": "prior-review/retainedFindings"
    },
    "transform": {
      "findings": {
        "map": ["/inputs/reviewers/*/findings/*", "/inputs/extra"],
        "missingAsEmpty": true,
        "distinctBy": "/id",
        "template": {
          "reviewer": {"select": "^/name"},
          "reviewerKey": {"select": "^@key"},
          "findingIndex": {"select": "@index"},
          "finding": {"merge": [
            {"select": ""},
            {"find": {"collection": "$/inputs/prior", "key": "/id", "value": "/id"}}
          ]}
        }
      }
    }
  },
  {
    "id": "actionable", "name": "Open findings", "type": "transform",
    "reads": {"findings": "aggregate/findings"},
    "transform": {
      "findings": {
        "map": "/inputs/findings",
        "where": {"all": [
          {"path": "/finding/rating", "min": 2},
          {"path": "/finding/status", "equals": "open"}
        ]},
        "template": {
          "id": {"select": "/finding/id"},
          "body": {"select": "/finding/body"},
          "rating": {"select": "/finding/rating"},
          "status": {"select": "/finding/status"},
          "reviewer": {"select": "/reviewer"},
          "reviewerKey": {"select": "/reviewerKey"}
        }
      }
    }
  }
]
```

For `reviewers.alice = {name: "Alice", findings: [{id: "F1", body: "Fix X",
rating: 3, status: "open"}]}` and `prior = [{id: "F1", status: "resolved",
reason: "Fixed"}]`, `aggregate` retains the full finding with `status: "resolved"`,
`reason: "Fixed"`, reviewer `Alice` and key `alice`. `actionable.findings` is empty.
Without that prior disposition, the finding stays open and is emitted by
`actionable`. Optional extra findings without a reviewer parent receive `null`
reviewer metadata; their own fields remain available inside `finding`.

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
`category: "io"` and use a registry executor (not the legacy inline boundary).
Wait resolves `nodeRegistry.effectFor(body)`, which parses schema defaults and uses
shared `nodeEffect` metadata. Its resolved effect must be `read-only` or `pure`;
`agent`, `human`, `effect`, and `flow` bodies are rejected. Metadata may declare
`operationEffects` (selected by `op`) and `accessEffects` (selected by string
`access`), with operation taking precedence and unknown selectors falling back to
the conservative node default. Both maps cross the JSON builder boundary. This
supports nodes that mix read and write operations, and read-only exec access.
The read classifications are explicit node contracts: a node author must only
assign them to IO that does not write provider/repository state. This
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
are logged as failed polls, retaining the last successful output, and polling
continues until the deadline. Optional `maxErrors` (1–10,000) caps failed polls
across the entire visit, including restarts and wrapper retries; reaching it
throws the body error for the wrapper's retry/onError policy. The
embedded body cannot carry routes or retry/onError; put those on the Wait.

Wait uses `ctx.phase("waiting-ci", ...)` across polling and sleeping. Wait itself
requests no execution capacity; a read-only Exec body acquires a lease for each
command and releases it before the polling interval. There is one progress line per visit and one final
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
writes safe or waive an uncertain effect. Sending/uncertain effect failures never
route through `onError`: the visit and action identity remain retained for operator
reconciliation. Automatic retries count once against the convergence attempt budget.

After exhaustion, `onError` routes to a step in the same lexical graph. The
handler declares `reads: {error: "@error"}` (or `@error/message`), then reads
`/inputs/error` from Check/Transform. The value is `{message, kind}`: `kind` is
an explicit string error kind when present, otherwise the error's name, otherwise
`"Error"`. This runtime-owned context is scoped to that graph frame and retains
the last routed error through restart until the next successful step (normally
the handler) clears it; it is not a producer output. Error routes
must name an actual local step, not `end` or a declared return outcome. Ordinary
visit limits still bound error-route loops.

Without these properties, execution failure behaves as before. Cancellation,
shutdown, update pauses, workflow unavailability and non-convergence pauses do
not retry or enter an error handler. Non-convergence still requires human Continue. A false Check
result, a timeout result, or a node's ordinary structured business result remains
normal data for branches. Existing special recovery paths retain precedence.
All builder node panels expose the common retry policy and error destination.

## Merge, ticket and exec IO

These nodes register their palette templates and use the generic JSON settings
panel. Their receipts are ordinary stamped outputs; node IDs have no special
meaning. Existing `tool: merge`, `tool: exec` and external tools remain available
for frozen legacy recipes.

### Operation effects and polling

`nodeEffect(step)` in `nodes/metadata.ts` (also exposed as
`nodeRegistry.effectFor(step)`, which parses defaults) resolves serializable
`operationEffects` and `accessEffects` overrides, then the conservative node
`effect`. Unknown operations remain effects. Polling nodes must use this resolved
class, not just `definition.effect`: `ticket` with `op: read` and `exec` with
`access: read-only` are **read-only**; every other B6 operation is **effect**.
The same operation metadata is available to other IO nodes and browser clients.
A `wait` wrapper must validate this class both when parsing and before executing
its body. Read-only polls do not enter `ctx.effect` or cache previous reads.

### merge

Configuration: `requests?: [{repositoryId, url, headSha}]`,
`method?: "merge" | "squash" | "rebase"`, `pollInterval` (ms, default 10000),
`timeout` (ms per repository wait, default 3600000). Otherwise `reads.requests`
provides the requests: a single PR, an array, a legacy grouped `deliveries`
receipt, or B5's `{repositories: [{id, url, head}]}` receipt. `headRefOid` is also
accepted as the bound revision. Only repositories selected for the run can merge.
The default method comes from the configured Git provider.

Output: `{repositories: [{repositoryId, merged: true, sha, url}]}`. `sha` is the
provider-confirmed merge commit (the source head for a fast-forward merge). Custom Git providers must
return `mergeCommitSha` from `view` for a merged request. Repository reservations
use the same canonical repository/base identity as existing publication, and
all admission/queue/confirmation waits use `ctx.phase("waiting-ci")`. Provider
resolution, head/readiness checks and reservation admission happen before the
durable send boundary, so pre-dispatch failures can retry. The reservation is
released as soon as the provider merge call settles; confirmation polling never
holds it. Each
repository has an independent durable effect, so partial success survives retry.
An uncertain request is only polled for confirmation; an open PR is **unknown**,
not evidence that the merge was absent. It never triggers another merge request.
A queue timeout or unavailable provider retains an uncertain receipt for retry.

There is no human approval, impact or lifecycle gate in this node. Recipes must
place their own checks before it, for example `check(approved && fresh(approval))`.
The Git provider still enforces its native branch rules and merge queues.

### ticket

Configuration: `op` (default `read`), optional `reference`, `commentBody`, `fields`,
`statusType`, `url`, `teamId`. The corresponding named reads are `reference`,
`body`, `fields`, `statusType`, `url`; explicit configuration takes precedence.
`reference` defaults to the run's originating ticket. `commentBody` is named this
way because `body` already denotes nested graph steps. Bind a display document's
plain-text fallback to `reads.body` when a formatted document should be posted.

- `read`: complete provider fields, `comments` and `attachments`.
- `comment`: a string from `commentBody` or `reads.body`.
- `set-status`: a status **type**: `triage`, `backlog`, `unstarted`, `started`,
  `completed`, `canceled`. Taskbot maps these to its native status vocabulary;
  `triage` maps to backlog. No tool/step name chooses status.
- `update`: `fields: {title?, description?, priority?}`; description is the body.
- `create`: `fields.title` required, optional description/priority/teamId. Linear
  and Taskbot reuse existing creation helpers, defaulting to backlog/unassigned.
  Creation markers/Linear UUIDs reuse the durable effect key.
- `link`: a URL. Linear/native trackers use their attachment transport; Taskbot
  uses attachments. GitHub stores an explicit link comment.

Mutating outputs: `{ok: true, id, url}` (the newly created identity for `create`).
Comments contain a stable searchable marker. Status/update/link retries confirm
current provider state and reapply the same idempotent intent when it differs.
Confirmed effects reuse their saved receipt across restart. GitHub creation uses
a repository-scoped issue search for the exact body marker, rather than listing
all issues and PRs. Search absence during reconciliation remains unknown because
indexing can lag; it never authorizes a duplicate create.

References:

- Linear and other native trackers: the existing
  `{provider: "native", platform, workspaceId, id, url}` reference; the configured
  TicketManager and workspace tracker perform the IO.
- Taskbot: `{provider: "taskbot", server, instance, project, id, url}`; the
  configured MCP connection must match the verified instance.
- GitHub issues: `{provider: "github", repositoryId, number}`; credentials and
  repository URL come from the run's configured repository. Generic status types
  are preserved in `factory-status:<type>` labels alongside native open/closed
  state. Numeric priority is unsupported and rejected.
- File tickets: `{provider: "file", repositoryId, id}`. JSON records live under
  the runtime-owned `factoryHome/factory/tickets/<repository-hash>/`; IDs cannot
  escape this directory. Creation IDs derive from the durable effect identity,
  and synchronous locked mutations preserve unrelated fields/comments.

**Milestone decision:** new definitions (`engineVersion: "nodes-v1"`, shared with
B3) explicitly call `ticket set-status` and `ticket comment`. No generic
`ticketMilestone` property is added. Automatic legacy `TicketTracking` milestones
are suppressed at the runtime tracking boundary for those definitions, including
start/terminal and tool-name-based milestones. Definitions without the marker
retain the existing tracking behavior; accepted saved graphs are not migrated.

### exec

Configuration: `command` (executable), `args` (array, default `[]`),
`access: "read-only" | "workspace"` (default `read-only`), `timeout` (ms, default
120000, max one hour), `env` (environment variable **name allowlist**, default
`["PATH", "LANG"]`), `json` (default false). Commands run in the workspace; use
`command: "/bin/sh", args: ["-c", "..."]` when shell syntax is needed.

Output: `{exitCode, stdout, stderr, json?}`. Nonzero exit codes are structured
results; timeout, cancellation, spawn failure and invalid requested JSON fail the
node. Each stream is bounded to its last one million characters. Execution-profile redaction is
applied before output is retained. Only allowlisted host/profile environment
variables are inherited; internal capacity provenance is also retained. Mutating commands additionally receive
`FACTORY_EFFECT_KEY` for downstream idempotency.

Writes are enforced by the OS for the process and descendants: macOS
`sandbox-exec`, or Linux `bwrap` (bubblewrap must be installed). Read-only commands
cannot write host files or use the network. Both access modes retain host file
reads, including the home directory: this is not a confidentiality sandbox.
Workspace access retains network access and permits writes under the resolved
workspace, its Git metadata (including the linked worktree's common objects/refs),
and a private scratch directory supplied as `TMPDIR`. Scratch is removed when
the command settles. Other host writes remain denied. Unsupported/missing
enforcement fails closed. A timeout or
cancellation terminates the process group, escalating to SIGKILL. Mutating exec
acquires its capacity lease before entering `ctx.effect`, so a queued shutdown
can resume without marking an unstarted command uncertain. It deliberately has
no generic reconciliation: after an
uncertain command, the operator must reconcile its external outcome. A confirmed
command is not run again. Arbitrary shell side effects cannot be safely inferred
from a local exit code after a crash.

## Repository IO: `git`, `pr`, `ci`

All three nodes have `category: "io"`, use the run's frozen repository scope and
return `{ repositories: [{ id, head, ...operationResult }] }`, including for a
single repository. `head` is an actual repository commit, never a group digest.
`base` is included when the operation observes a base commit. Repositories execute
in scope order, with distinct durable effect names per repository. A failure stops
the step; retry reuses earlier confirmed effects. Existing domain tools remain
available and are not invoked by these nodes.

Configuration uses the ordinary step fields, a `type` and an `op`. String payloads
come from named `reads`, resolved by the runtime before execution. `git commit`
reads `message`; `pr ensure` reads `title` and `body`; `pr comment` reads `body`.
The same payload applies to each scoped repository. `body` may be empty for ensure.
`pr read/comment/ready` and `ci status/rerun` optionally read `pr`, either a prior
node's `{ repositories: [{ id, url }] }` result or `{ url }` for one repository.
Without that binding they discover the unique open request for the worktree branch;
zero or multiple matches fail. A bound URL is always checked against the selected
repository/provider. Bind a URL to inspect a closed request.

### `git`

- `status`: `{ type: "git", op: "status" }` → each repository has
  `{ id, head, branch, dirty }`.
- `commit`: `{ type: "git", op: "commit", reads: { message: "metadata/message" } }`
  → `{ id, head, committed }`. Stages all changes and commits only when dirty;
  clean worktrees return `committed: false`. Keeps normal commit hooks, configured
  Git identity/signing, execution-profile credentials and the host SSH-agent
  selection. Retains the pre-commit head and adds a `Factory-Effect` trailer to reconcile a
  lost commit response; an unchanged head proves a failed signing/hook attempt
  created no commit and permits a retry.
- `push`: `{ type: "git", op: "push" }` → `{ id, head, branch, pushed: true }`.
  Pushes the observed SHA to the current branch on `origin`, without force.
  Recovery confirms that exact remote SHA; a different remote head remains unknown.
- `rev-parse`: `{ type: "git", op: "rev-parse", ref: "HEAD" }`
  → `{ id, head, ref, revision }`. Resolves a commit, with ref option injection
  rejected. `ref` defaults to `HEAD`.
- `diff`: `{ type: "git", op: "diff", from: "refs/remotes/origin/main", to: "HEAD" }`
  → `{ id, head, base, target, files: string[], changes: [{ path, additions,
  deletions }], stats: { filesChanged, additions, deletions, binaryFiles } }`.
  Defaults to the run's `origin/<baseBranch>` and `HEAD`; compares the two exact
  commits without fetching. Binary additions/deletions are `null`. NUL-separated
  Git output preserves whitespace and tabs in paths; renames appear as add/delete.

Commit/push require the run's dedicated linked worktree, its exact root and a
non-base branch. Source clones and detached HEADs are rejected. These nodes do not
create worktrees, change identity settings, disable signing or bypass hooks.

### `pr`

- `ensure`: `{ type: "pr", op: "ensure", reads: { title: "metadata/title",
  body: "metadata/body" } }` → `{ id, head, url, isDraft }`. Creates an open draft,
  or updates an existing draft's title/body. Existing ready requests are returned
  without changing their metadata or draft state. The branch/base must match the
  scoped worktree; cross-repository requests are rejected.
- `read`: `{ type: "pr", op: "read", reads: { pr: "opened" } }`
  → `{ id, head, base, url, number, title, body, headRefName, headRefOid,
  baseRefName, baseSha, state, isDraft, isCrossRepository, mergeability, reviews,
  unresolvedThreads, reviewComments, labels, checks, checksSummary }`.
  State is `OPEN | MERGED | CLOSED`; mergeability retains the provider's factual
  status (`unknown` when unavailable). Discussion/review payloads retain provider
  detail; GitLab approvals populate `reviews`. Checks reuse `ProviderCheck` and
  summary is `{ total, passed, failed, pending, complete }`.
- `comment`: `{ type: "pr", op: "comment", reads: { pr: "opened",
  body: "metadata/body" } }` → `{ id, head, url, comment: { id, body, url? } }`.
- `ready`: `{ type: "pr", op: "ready", reads: { pr: "opened" } }`
  → `{ id, head, url, isDraft: false }`. Verifies the provider's ready state at
  the requested head; already-ready requests are a no-op.

Ensure/comment use `ctx.effect` with `<!-- factory-effect:<key> -->` markers in
provider-visible bodies. Recovery reads complete provider lists: an exact marker
and intent confirms the receipt; an independently empty result proves absence
(`null`) and permits resending with the same key/marker. Conflicting metadata,
unavailable reads or an unrecognized outcome remain unknown (`undefined` or a
read error) and block resending. Ready is reconciled by provider state. The
public `GitProvider.read/update/comments/comment` helpers retain repository URL
validation and are reusable by other IO nodes. Custom executable adapters may
implement the corresponding operations; their existing operations remain intact.

### `ci`

- `status`: `{ type: "ci", op: "status", reads: { pr: "opened" } }`
  → `{ repositories: [{ id, head, base, url, checks: [{ name, required,
  conclusion, status, url, failureLogExcerpt, infraFailure, retry }],
  summary: { total, passed, failed, pending, complete }, infraFailure }] }`.
  `status` is `pass | fail | pending`; `conclusion` retains the provider value.
  Required/optional classification comes from GitHub's per-PR `isRequired` or
  GitLab's `allow_failure`/pipeline requirement. Unknown custom-adapter required
  status is `null`. URLs and unavailable failure excerpts are `null`.
  Excerpts are bounded to 8,000 characters, using GitHub check failure output or
  GitLab job traces (falling back to its failure reason if the trace is unavailable).
  `infraFailure` reuses the existing provider classifier, never check-name guesses.
  CI requires the request head to equal the current local head. This is one read
  pass: it does not poll, sleep, rerun checks or apply routing rules.
- `rerun`: same configuration with `op: "rerun"` → the status shape plus
  `reruns: [{ check, retry, requested: true }]` per repository. Only infrastructure
  failures with a provider retry identity bound to the current head are eligible.
  Multiple check contexts for one run/attempt produce one effect. Unknown retry
  outcomes are not resent; recovery requires proof of a newer/running attempt.
  Code/metadata failures are left to recipe routing. No polling is embedded here.

### Operation effects and read-only wrappers

The definitions conservatively declare `effect: "effect"` and publish a
serializable `operationEffects` map through registry metadata. On parsed steps,
server wrappers such as `wait` should call `nodeRegistry.effectFor(step)` and
accept only `"pure"` children. Browser code can use `nodeEffect(step)` from
`nodes/metadata.ts` against the hydrated catalog. Unknown operations fall back to
the definition's conservative effect class, never an implicit read-only grant.

Read-only operations are `git status/rev-parse/diff`, `pr read`, and `ci status`.
All other operations are `effect` and use `ctx.effect`. Here `pure` means read-only
IO, not deterministic or cached IO. A wait wrapper must execute a fresh read on
each poll. This metadata does not confer permissions. Palette entries and the
generic JSON settings panels come from these same definitions; defaults are
`git status`, `pr read` and `ci status`.

A minimal recipe fragment (after a `metadata` producer returning message/title/body):

```json
[
  { "id": "commit", "name": "Commit", "type": "git", "op": "commit",
    "reads": { "message": "metadata/message" } },
  { "id": "push", "name": "Push", "type": "git", "op": "push" },
  { "id": "opened", "name": "Open PR", "type": "pr", "op": "ensure",
    "reads": { "title": "metadata/title", "body": "metadata/body" } },
  { "id": "checks", "name": "CI status", "type": "ci", "op": "status",
    "reads": { "pr": "opened" } }
]
```

`RepositoryIONodes.test.ts` runs this sequence with mocked Git/providers over two
repositories, and tests uncertain sends across cold runtime restarts.
`GitProvider.test.ts` covers the new GitHub/GitLab transport helpers. The scripted
F1 fixture `apps/f1/test-drives/assets/repository-io-nodes.ts` uses real Git,
mocked agents and a simulated GitLab API, including a lost creation response and
worker restart.
