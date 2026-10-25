# Display documents

The `display` node presents one document assembled from generic components. It
continues immediately for content and waits durably when the document contains
form fields, actions, item controls or code-note comments. Existing human steps
and presets remain supported; recipes are not converted by this change.

```json
{
  "id": "preferences",
  "name": "Choose a direction",
  "type": "display",
  "document": {
    "version": "view-v1",
    "components": [
      {
        "id": "intro",
        "type": "markdown",
        "data": { "literal": { "text": "Choose what happens next." } }
      },
      {
        "id": "fields",
        "type": "form",
        "data": { "literal": { "fields": [
          { "id": "notes", "type": "textarea", "label": "Notes" }
        ] } }
      },
      {
        "id": "buttons",
        "type": "actions",
        "data": { "literal": { "actions": [
          { "id": "continue", "label": "Continue" }
        ] } }
      }
    ]
  }
}
```

A node accepts exactly one `document` or `from`. Use named `reads` and the
existing ViewSource bindings: `data.literal`, `data.path`, or per-field
`data.bindings` (including bounded collection projections). Pointers address
`/inputs`, `/item` and `/index`; private run state is unavailable. Sections hold
another component list in `data.components`, with optional `collapsed`.
Documents use `view-v1` for binding compatibility and have no preset. Inline
document-local reads are normalized into the node reads so the engine stamps
the actual inputs.

The components are `markdown`, `points`, `checklist`, `table`, `chart`,
`beforeAfter`, `steps`, `code`, `screenshots`, `video`, `itemCards`, `form`,
`actions`, `runList`, `section` and `codeTour`. All have inert text fallbacks.
The schema endpoint `/api/recipes/display-schema` and builder editor describe
the data shapes. Every document is validated again after resolving bindings and
at the browser rendering boundary. A document permits at most 40 components
including nested sections, eight section levels and unique component/control IDs.
HTML strings never become executable HTML. Screenshots and video retain the
existing run-inventory and digest checks, including inside sections.

Forms support `text`, `textarea`, `select`, `checkbox` and `choice`. Choices have
`options: [{id,label,reason?}]`, optional `custom`, `value`, and
`recommendation: {answer,reason}`. Defaults never submit automatically. Selecting
Custom answer clears the default; an explicitly empty answer stays empty (or
fails validation for a required field).

Item cards have `items: [{id,title,body?,details?,value?}]`, optional
`actions: [{id,label,comment?,followUp?}]`, `comment` and `ask: {prompt}`.
Selections route on `itemsByAction`: each array contains the original `value`
(or the displayed item when value is absent). Ask uses the existing restricted
context follow-up, keeps a durable thread, and changes the submission digest
when the thread changes. Document data grants no tool or provider authority.

Code tours use `files: [{id,path,hunks,notes}]` and optional `comment`. Hunks
contain unified diff text. Notes use `{id,line,side?:"old"|"new",text}` and pin
to the corresponding diff line. The existing diff renderer renders the data;
comment answers use the note ID and action `comment`.

Agents can set `output: {"format":"display"}` and return the document directly.
For an agent-produced document, declare a read and use
`"from":"/inputs/author"`. For the agent needs-input pattern, the agent's own
output schema can wrap the document in `{status:"needs-input",display:…}`;
read that output and use `"from":"/inputs/author/display"`, then route the
accepted answer back to the agent. The format enforces document structure;
recipes and agent schemas own any required content or arrangement.

Answers use the existing `/api/runs/:id/view-answer` API and explicit terminal
or ticket `/view-answer` JSON command. Supply the current `batchId`, `digest`,
`accepted:true`, optional `documentDigest`, `action`, `values`, and
`choices:[{itemId,action,comment?}]`. The submission digest covers the complete
current display and Ask discussion. A supplied stale document digest is also
rejected. A response never silently targets a newer document.

```json
{
  "action": "continue",
  "values": { "notes": "Proceed" },
  "items": {},
  "itemsByAction": {},
  "followUps": [],
  "comments": {},
  "documentDigest": "<SHA-256 of resolved document>",
  "bound": []
}
```

`action` is null without document actions. The optional step `bind` is passed
through as `bound`; the generic binding implementation owns bound-digest
storage and freshness policy. Display does not implement `bind` or `fresh`.
