# Declarative recipe views

Custom recipes can use `decide`, `approve` and `show` steps. Stock Questions,
Check-in, Human review and External review also use accepted `step.view`
declarations, with Ask, Approve, Review and External review presets. Their
existing native decision protocols and approval requirements remain authoritative.
Saving a recipe does not rewrite an accepted run.

Every step declares a `view`: either a `view-v1` component list or
`{"from":"/inputs/presentation"}` referring to an agent's validated `view-v1`
output. Each component has a unique `id`, `type`, optional `title` and `data`:
`{"literal": ...}` or `{"path":"/inputs/alias/..."}`. JSON Pointers use RFC 6901
escaping. Only declared `/inputs`, lexical `/item` and `/index` are available;
private run state is never a binding root. Reads are unconditional and name
earlier outputs or explicit public `@callInputs`, `@item`, `@index`,
`@launchInputs` or `@childRuns` sources. Unknown components, input shapes,
unsafe pointers and missing data fail clearly. There are no HTML templates,
expressions or script evaluation.

```json
{
  "id": "choose-work",
  "name": "Choose the next work",
  "type": "decide",
  "reads": {"research": "investigate"},
  "view": {
    "version": "view-v1",
    "components": [{
      "id": "intro", "type": "markdown",
      "data": {"literal": {"text": "Choose an action for each finding."}}
    }]
  },
  "decide": {
    "items": {"path": "/inputs/research/items"},
    "itemId": "/id", "title": "/title", "body": "/summary",
    "details": [{"label": "Evidence", "path": "/evidence"}],
    "actions": [
      {"id": "fix", "label": "Fix", "comment": true},
      {"id": "ask", "label": "Follow up", "comment": true, "followUp": true},
      {"id": "skip", "label": "Skip"}
    ],
    "ask": {"prompt": "Answer the question using the supplied item and view context."}
  },
  "branches": [{"when": {"path": "hasFollowUps", "equals": true}, "next": "answer-followups"}],
  "next": "continue-work"
}
```

`Decide` requires one configured action for every item. Items have unique safe IDs
(letters, digits, `_` and `-`, up to 80 characters; prototype keys are forbidden).
The output is `choices`, `itemsByAction.<action>`, `followUps`, `hasFollowUps` and
form `fields`. Action comments are optional and allowed only when configured.
Inline **Ask** uses its own retained thread and a dedicated context-only agent
with only bounded context-list/read tools for the displayed item, question, public discussion and view. The enforced provider profile clears inherited tools, settings, external MCP servers, plugins, filesystem/shell, web, delegation and artifact powers. It does not require a Snapshot. Unsupported native permission profiles fail before a model turn; providers are never silently switched. It never reruns the source agent. The model
inherits the run unless the optional `ask` settings select one. Selecting a
follow-up action is separate from inline discussion and routes normally. The original native provider, model and session remain bound to the thread on resume. Late replies settle their historical batch and cannot replace a renewed or accepted current decision.

Context-only execution uses the existing prepared provider; it does not bundle
external agent executables or credentials. Claude uses an empty native tool set,
strict MCP/settings sources and both pre-tool and permission denial. Cursor uses
its actual native hooks with default denial and exact context transport/tool
checks. Known mandatory managed/startup-hook configurations fail closed. Codex
requires a native effective permission profile; the verified 0.163.0 adapter
disables shell/web/delegation/discovery and denies filesystem and network effects
outside minimal native runtime/private empty cwd reads. Native `apply_patch` may
remain named, but its filesystem effects are denied. Native configuration or
cached tools that reopen access reject before a turn. OpenCode isolates config
discovery while retaining its original native data/auth store. Before **any native
invocation**, it refuses nonempty legacy/auth-only stores without the canonical
SQLite database, unknown schemas/journals, unsafe startup layouts and uncheckpointed
writes. A genuinely empty new store remains usable. The supported initialized
format is OpenCode 1.2.27's complete migration journal. Built-in read-only SQLite
queries inspect only schema, approval and active-organization metadata, never
messages/parts or credential values. Version discovery uses an empty private
factory directory. A bounded native provider-type listing then rejects well-known
configuration sources; model metadata fetching is disabled and original native
logs cannot be created/cleaned by that metadata command. The original native
store/session/model is never replaced or migrated to make a refusal succeed.
Concurrent external store replacement is not an atomic filesystem transaction;
identity/WAL checks are repeated before the verified native startup. Unsafe or
unverifiable remote organization/settings authority refuses before a model turn.
Unattested or broader saved OpenCode
permissions remain preserved and refuse resume. Unsupported Gemini assistance
fails clearly before provider work. Mocked transport/config tests do not claim
live provider quality or other-platform native enforcement.

`Approve` has the same view/read fields and returns `approved`, `feedback` and
`fields`. Approve requires explicit human confirmation; Request changes requires
feedback. The server binds the exact displayed content, action/form configuration,
batch/frame identity and verified media to its own digest. Changed data, content,
configuration, Ask history or assets invalidate old submissions. Changed source
content creates a fresh batch. Original snapshots and accepted responses remain
retained. Conflicting concurrent answers fail; exact accepted retries return the
original response. Generic approval cannot authorize native architecture recovery,
external acceptance, publication or merge.

`Show` retains a display and advances immediately, without human attention or a
long-lived execution lease. Its text fallback is published asynchronously.
Blocking Decide/Approve steps belong outside For each and Parallel, including
their called recipes. Sequential Call recipe can wait for a human. Completed
Call/For each outputs can feed subsequent views, and Show is supported inside
their lexical frames.

## Stock human presets

Agent question waits and native human actions can declare the same `view-v1`
components. A view may declare a `preset` (`ask`, `approve`, `review`, or
`external-review`) and view-local `reads`. These reads describe presentation only:
`@human` is the current public question/proposal/guide projection; `@callInputs`
and its JSON Pointer descendants are public mapped input; ordinary producer names
resolve in the accepted lexical Call frame. Private checkpoints, diagnostics and
native credentials are unavailable. Native action reads and contracts remain
separate from presentation reads.

For example, a fork of **Check in with you** can move size first, hide optional
sections, and add the actual configured proposal's plan:

```json
{
  "version": "view-v1",
  "preset": "approve",
  "reads": {
    "human": "@human",
    "plan": "architecture/candidate/plan"
  },
  "components": [
    {"id":"size","type":"checkin-section","data":{"path":"/inputs/human/sections/size"}},
    {"id":"goal","type":"checkin-section","data":{"path":"/inputs/human/sections/understood"}},
    {"id":"plan","type":"markdown","data":{"bindings":{"text":{"path":"/inputs/plan"}}}}
  ]
}
```

Use **Human view → View JSON** in the ordinary recipe editor, then Save. Factory
forks retain their private called-recipe closure; export/reload retains these
views. Component order controls display order. Removing an optional component
does not remove native open questions, exact candidate/assets acceptance, review
requirements, repository URL/head bindings, external verification, final drift
checks, or uncertainty recovery. Existing producer and receiving text limits
still apply; oversized bound text is refused rather than silently shortened.

The Questions component reuses the existing explicit answer form: defaults never
submit themselves, an explicitly blank custom answer remains incomplete, and
question batch/retry/dedup and native terminal/ticket reply behavior stay intact.
Current question waits take precedence over retained rejected review records.
The terminal displays the declared native view text and current identity; Approve
and Request changes capture that displayed consent before confirmation. A later
refresh cannot substitute an unseen version. A pending generic decision keeps its
exact answer protocol first; otherwise the current native presentation and display
digest precede retained Show history within the same text budget. Completed guides whose native gate
is no longer retained receive a read-only stock presentation from their accepted
configured producer, with the original reading-progress identity and no new
approval authority. A rejected review also retains a separate read-only review
presentation/resource while a later Ask owns the current batch and answer form.
The saved guide uses the original rich reader and progress identity; its display
digest cannot answer the current Ask or restore native review controls.
Check-in sections reuse the existing points and combine reactions into one change
request. The saved check-in route selects the requested proposal/version’s owning
declaration and proposal resource, including its candidate, rather than the run’s
current Ask or Review display. Optional notes follow that declaration. Historical
readers are read-only; only the current native check-in can supply decision consent.
Declared `@callInputs` reads follow the exact accepted lexical path into the owning
retained Call frame, including after the run advances; another active frame or
similarly named output cannot replace that context.
The rich `review-guide` component reuses the original show & tell,
Dig deeper, flows, code tour with line notes, tests/checks/choices, comments,
Decide page, feedback count and reading progress. Reading position and draft
feedback are independent of approval authority.

Check-in and guide components contain inert source/digest references and useful
text fallbacks. Only the owning run's verified public resource registry can attach
the original rich reader and its native controller. A reference is never a URL,
filesystem path, HTML template or script. Large guides retain the original lazy,
hash-checked artifact reader and protected code/media readers. Outside that native
context, the reference is plain display text; it cannot manufacture approval.

New native approval API submissions include `display: {"digest":"…"}` from
`nativeView` alongside the original architecture or review payload. The server
rechecks accepted configuration, native batch/proposal/review, declared content,
all repository URL/head pairs and protected assets immediately before the native
transition. An authored Approve label or generic `accepted:true` never populates
native architecture/human/delivery/merge fields. Original frozen native protocols
remain readable; old definitions receive an in-memory declarative adapter without
rewriting their accepted graphs. Presentation owner metadata is distinct from
native decision receipts. Cached old clients and native question channels retain
their original protocols.

The terminal/API exposes bounded inert view text. New explicitly declared native
views use the same fallback in ticket notifications while retaining original
question/review deduplication keys. An incomplete text fallback directs the reader
to the complete dashboard display and never claims omitted content was reviewed.

## Component data

The builder's **Component schema and examples** exposes the complete schema.
All objects reject unknown keys. A view has at most 40 components; ordinary
component lists have at most 100 items. Traversal is bounded to safe acyclic
plain JSON (1 MiB, depth 32); a run retains at most 100 view snapshots. Text
fallbacks are bounded and explicitly mark truncation. The current pending decision and its exact batch, digest and answer command appear before historical Shows. Public Ask questions, replies, errors and pending/answered status are included. A shortened fallback does not claim unseen content was reviewed: open the complete dashboard display, discussion and assets before accepting.

Push notifications stay private by default. Only a trusted recipe edit with explicit operator consent may set `notifications: {"push":"view-text"}` on a human step. This discloses bounded escaped component/discussion text to the push provider and device lock screen. The accepted snapshot and queued event retain this choice and exact batch/digest; later edits cannot upgrade private events, and agent-authored views cannot opt in. Existing device/operator consent, at-most-one attempt and no-replay policy still apply.

| Type | `data` value |
| --- | --- |
| `markdown` | `{text}`; safe Markdown without HTML or remote images |
| `checklist` | `{items:[{label,detail?,state:"done"|"partly"|"open"}]}` |
| `beforeAfter` | `{before,after,note?}` |
| `chart` | `{kind:"bar"|"line",series:[{label,value}],unit?}`; numeric values |
| `screenshots` | `{items:[{index,sha256,alt,caption?}]}`; current run's protected capture inventory |
| `video` | `{taskId,sha256,label,transcript}`; current run's verified recording |
| `table` | `{columns:[...],rows:[[...]]}`; scalar cells, matching column counts |
| `code` | `{file,excerpt?,language?,startLine?,endLine?}`; repository-relative display reference |
| `steps` | `{items:[{label,detail?,status?}]}` |
| `points` | `{items:[{label,detail?,url?}]}`; credential-free HTTP(S) links |
| `itemCards` | `{items:[{id,title,body?,details:[{label,value}]}]}`; presentation only |
| `choices` | `{fields:[{id,label,type,required?,value?,options?}]}`; text, textarea, select or checkbox |
| `runList` | `{waves:[{id,label?,runs:[{id,title,status,note?}]}]}` |
| `decisionBar` | `{summary?,actions:[{id,label}]}`; sticky presentation labels |
| `questions` | `{questions,questionChoices?,questionRecommendations?}`; explicit native Ask form or inert text |
| `checkin-section` | `{section,proposalId,digest,text}`; one existing proposal point or Bob’s notes |
| `review-guide` | `{source,digest,text}`; original rich reader only for the owning public guide resource |

View-provided action labels grant no authority. Actual human controls come only
from the accepted step configuration. Screenshot/video references cannot choose
filesystem paths, another run or remote media. Images are limited to 10 MiB before
body reads, including the protected view image API. Bytes and original verified
inventory are checked at display creation and approval; code excerpts remain
inert text. Every component has a useful plain-text fallback, escaping HTML,
Markdown links and terminal controls.

For live child-run state, use `reads: {"children":"@childRuns"}` and a `runList`
binding to `/inputs/children`. This is the protected public projection of Launch
run waves/statuses; it excludes child prompts, private execution bindings and
filesystem paths. Show retains the observed snapshot; ordinary child-run controls
continue to show current operational progress.

## Answer channels and previews

The dashboard and authenticated API use
`POST /api/runs/:id/view-answer` with the server's `batchId`, `digest`,
`accepted:true` and either `choices`/`fields` or `approved`/`feedback`.
`POST /api/runs/:id/view-ask` accepts the current batch/digest, `itemId`,
`question` and a stable UUID `requestId`. Reusing a request ID cannot start a
duplicate thread. Restart preserves waits, original answers and Ask sessions.
New decision notification claims survive restart; Show creates no decision push.

The terminal displays the same text and supports explicit JSON submissions.
Native ticket replies use `/view-answer { ... }` with the exact displayed batch
and digest. Ordinary replies and operate-scoped MCP `answer_run` grants cannot
approve views. Taskbot currently publishes fallback comments but has no incoming
reply-ingestion channel. Large text fallbacks direct readers to the complete
dashboard display. Ask admission/completion publishes an immutable ticket version
with its exact current batch/digest, discussion/status and answer command. Durable
outbox ownership skips obsolete unsent versions and deduplicates retries/restarts;
delivered history remains original. Immediately before an unsent provider write,
the runtime checks the exact active frame, batch and digest, re-resolves declared
configuration/content and verifies protected assets. Source changes supersede the
unsent version and renew the display without waiting for an Ask model turn. This
extends through local capacity admission, HTTP/SSE connection and header setup,
stdio framing, and initialized native Codex MCP handoff. The write thunk starts
inside the short final comparison; its response is awaited outside that transition.
Native Linear retries retain a private run/receipt/batch/digest/delivery binding,
separate from the provider input. Recovery without its runtime validator stays
pending; known-unsent obsolete versions retire without delivery confirmation.
Ambiguous attempts reconcile their original ID and exact wire content first.
A Taskbot comment's original marker and body are reconciled before a newer Ask
digest or batch can retire it. The final transport guard covers the exact locally
generated mutation envelope; ping replies and cancellation cannot revoke a sent
attempt. A redirected mutation still retains its original uncertain outcome if a
later handoff is refused. Protected-file identity is checked again after the local
transition queue, using stamps retained from bounded byte verification. A competing
transition repeats byte/revision verification outside the lock; continually
unsettled authority defers delivery rather than declaring it obsolete.
A new digest always gets a new delivery identity. This is a final local check, not an atomic lock on an external provider or later source
changes; a subsequently changed display still requires fresh human review. No
remote read/write or model wait holds the human transition queue. Failed Ask exposes fixed recovery guidance in
API, dashboard, terminal, ticket, activity and opted-in push content. Raw native
failure diagnostics remain in the private persisted thread rather than these
public projections, including when old saved failures are read. Accepted original
answers/digests remain immutable. No notification claims to prove that the reader
saw media.

Recipes validates JSON while editing and prevents invalid saves. Available-path
autocomplete comes from the bounded preview scope. Sample preview data is local
to the editor. **Last run** uses the retained accepted bound-input snapshot and
shows its run, step, timestamp and whether the view configuration matches the
draft; it does not read arbitrary paths in saved runs. Preview interaction cannot
grant approval or launch an agent.

Component data can also use `bindings` to project exact declared fields, for example
`{ "bindings": { "text": { "path": "/inputs/proposals/summary" } } }`.
A collection field uses `{ "from": "/inputs/plans", "map": { "id": "/id",
"title": "/title", "body": "/reviewText" } }`; item pointers are relative to
each item, and the empty pointer reads the item itself. Maps are bounded to 100
items and 20 fields. No expressions or scripts execute, private sources are
unavailable, and the resolved component still passes its normal schema.

A path binding may set `"format":"json"` to display inert serialized public JSON
in an existing text field, for example `{ "bindings": { "text": { "path":
"/inputs/dependencyGraph", "format": "json" } } }`. Descriptor-safe public reads
are sanitized before serialization; the receiving component's text limit remains
unchanged. This makes the actual displayed Check value part of the existing digest.
