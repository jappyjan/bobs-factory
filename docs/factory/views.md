# Declarative recipe views

Custom recipes can use `decide`, `approve` and `show` steps. Existing Questions,
Check-in, Human review, External review and Improve screens keep their current
behavior. Saving a new recipe does not rewrite an accepted run.

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
with only context-list/read tools. It never reruns the source agent. The model
inherits the run unless the optional `ask` settings select one. Selecting a
follow-up action is separate from inline discussion and routes normally.

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

## Component data

The builder's **Component schema and examples** exposes the complete schema.
All objects reject unknown keys. A view has at most 40 components; ordinary
component lists have at most 100 items. Traversal is bounded to safe acyclic
plain JSON (1 MiB, depth 32); a run retains at most 100 view snapshots. Text
fallbacks are bounded and explicitly mark truncation.

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

View-provided action labels grant no authority. Actual human controls come only
from the accepted step configuration. Screenshot/video references cannot choose
filesystem paths, another run or remote media. Bytes and original verified
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
dashboard display. No notification claims to prove that the reader saw media.

Recipes validates JSON while editing and prevents invalid saves. Available-path
autocomplete comes from the bounded preview scope. Sample preview data is local
to the editor. **Last run** uses the retained accepted bound-input snapshot and
shows its run, step, timestamp and whether the view configuration matches the
draft; it does not read arbitrary paths in saved runs. Preview interaction cannot
grant approval or launch an agent.
