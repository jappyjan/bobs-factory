# Configurable agent steps (step-config-v1)

An agent's ID names its graph position. Behavior comes from optional configuration.
New Recipes graphs carry `stepConfigVersion: "step-config-v1"`; an individual
step can carry `configVersion: "step-config-v1"`. Omitted configuration leaves a
normal generic agent. A step called `implement`, `capture` or `guide` receives no
special behavior solely because of that name.

```json
{
  "id": "inspect-change",
  "name": "Inspect change",
  "type": "agent",
  "prompt": "Inspect the accepted change and return the findings.",
  "reads": { "plan": "accepted-plan/plan", "answers": "@answers" },
  "output": { "schema": {
    "type": "object",
    "properties": {
      "status": { "enum": ["completed", "blocked"] },
      "blockers": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["status", "blockers"],
    "additionalProperties": false
  } },
  "rules": [{
    "message": "Completed work has no blockers",
    "when": { "path": "/status", "equals": "completed" },
    "require": { "path": "/blockers", "empty": true }
  }],
  "revision": "bound",
  "access": "read-only"
}
```

`reads` maps input names to `step-id`, `step-id/property/path`, or named runtime
context (`@answers`, `@decisions`, `@reviewLedger`, `@reviewRounds`, `@repository`,
`@source`, `@ticket`, `@history`, `@launchInputs`, `@mergeReadiness`, `@feedback`,
`@reviewFix`, `@qaReuse`, `@architectureProposals`, `@architectureDecisions`). A
binding can be `{from, when}` with a declarative condition. The old `inputs`,
`review.inventory`, `review.fanout`, `impactSource` and `architectureSource` fields
remain thin binding aliases. Existing `inputs` restrictions retain their behavior.
Reads add named inputs and do not implicitly remove the existing run context.

`output` selects `{format: "<versioned-library-id>"}` or `{schema: {...}}`.
`OutputFormats.ts` lists every supported format, including historical Factory,
QA, guide/review-brief versions, Architecture/check-in, Impact, specialist,
inventory/coverage, delivery and improvement formats. Inline schemas use strict
Ajv draft-07 validation at save. Both compilation and output validation execute
in a separate disposable Node worker or Bun subprocess, never as generated code
on the HTTP/native execution thread. Normal schema failures and validation resource failures retain
the existing output-correction retry. Stopping a run or closing a schema request
cancels its queued/active worker instead of spending a correction attempt.

Inline schemas are restricted to 64 KiB, 512 schema nodes, 40 JSON nesting levels
and acyclic local JSON Pointer references. Remote references, custom/nested `$id`,
`$async`, recursive references, backreferences, lookarounds, nested repetitions and
repeated alternation groups are rejected at save. The same 512-character pattern
limit and unsafe-pattern checks apply to `patternProperties`. Ordinary types,
properties, required fields, enums, compositions, useful bounded patterns and
shared acyclic definitions remain available.

Pattern screening is only a preflight: remaining expensive regular expressions
and meta-schema checks are still isolated. Both runtimes apply a fixed 1-second
elapsed-time execution guard for compile plus validation. This permits cold Ajv
work and scheduling pauses within the independent outer limit. Every worker has
a 2-second wall deadline including
startup, enforced outside the validator. Node terminates the worker; Bun uses a
separate process killed with SIGKILL because Bun thread termination cannot
reliably interrupt native regular expressions. The
service allows two asynchronous workers and at most 16 queued jobs, with a
2-second queue-wait limit. Native output is limited to 256 KiB, 20,000 JSON values
and 64 nesting levels. Workflow HTTP saves accept at most 64 distinct inline
schemas and precompile them asynchronously; a missing/evicted compile result
fails closed. Synchronous compatibility callers use a worker bridge with the
same deadline; HTTP handlers never fall back to that blocking bridge.

Node additionally enforces a 96 MiB old-generation heap, 16 MiB young generation
and 2 MiB worker stack. Async Bun validation checks child RSS from the parent with
`ps` every 50 ms, kills above 256 MiB, and submits untrusted work only after a
positive startup RSS sample. A zero/missing sample receives a bounded 100 ms
recheck against process exit/close or confirmed OS reclamation. An unobservable
live process still fails closed, and a slot is not released before child close.
This is a sampled process-memory limit, not an engine heap cap;
synchronous Bun compatibility calls retain the input/graph caps and OS-enforced
wall deadline. Normal HTTP/native paths always use the asynchronous backend.
The compiled executable launches its private `internal-schema-validator` JSON
helper; it does not require a user-installed Ajv module or Node installation.

`revision: "bound"` records repository revisions and the effective supplied inputs,
including ordinary context when `reads` is omitted. Answer, decision and previously
supplied output changes invalidate reuse. The implicit output collection retains
its original key set and history retains its original cutoff on dependency refresh;
the producer's own newly appended result is excluded. This prevents a consumer's
bookkeeping from recursively invalidating its producer. Explicit named reads remain
live, including `@history` with only that producer's appended receipts excluded.
Self-result aliases, their derived delivery-candidate digest and the tracking
outbox are also bookkeeping exclusions; they cannot create new task evidence.
Native feedback, review-fix and QA-reuse sources also bind their inspected inputs.
Dependency refresh returns to the suspended consumer without replaying completed
intervening actions, retains native conversation identity and uses the visit budget.

Read-only inspection stamps retain the original repository snapshot through queued
admission, correction and native restart. Drift rejects the result and reruns the
step; completion never relabels an inspection with a later HEAD. Workspace agents
may change their repository, while concurrent effective-input changes still require
re-execution. Frozen legacy provenance and retry behavior keep their prior adapter.
Access
is `read-only`, `workspace` or `push`, optionally `{mode, tools}`. Read-only agents
use the runtime's pinned list/read context and repository tools. `instructions`
contains library IDs. Selected prompt snippets are appended automatically in the
listed order; use `{{instruction:<id>}}` in the prompt to choose an exact position
without adding the snippet twice. Runtime instruction IDs add role guidance in
their defined runtime slots. Stock prompt slots render their original text exactly.

## Rules

`rules-v1` is JSON data, with no expression evaluator, templates or scripts. Each
rule has `message`, optional `id`, `path` and `when`, and a required condition.
Paths are JSON Pointers; `*` selects all array elements or object values; `$`
selects from the original document inside nested `each`, `some` and `lookup`.

Conditions support:

- `all`, `any`, `not`; `each` and `some` with optional `where` and `require`.
- `path` with `equals`, `notEquals`, `equalsPath`, `in`, `exists`, `empty`, numeric
  `min`/`max`, `minLength`/`maxLength`, `maxItem`, `unique`, `within` and `disjoint`.
  `by` selects a key or a tuple of keys for uniqueness/set comparisons.
- `count` with `where`, `min` and `max`; numeric bounds can use a number, `{path}`,
  `{length: "/array"}` or bounded `{sum: [...]}` operands.
- `compare: {left, op, right}` with `eq`, `lt`, `lte`, `gt` or `gte`.
- `distinct: [pointers]` combines selected lists before checking uniqueness;
  `sameLength: {items, as}` checks selected rows against a column list.
- `lookup: {collection, key, value}` requires exactly one matching record, then
  evaluates `require` with `{item: <original scope>, match: <matched record>}`.
- `text: {path, test}` uses one fixed predicate: `nonblank`, `no-local-path`,
  `no-commit-sha`, or `repository-relative`.
- `conforms: "<format-id>"` is a semantic format predicate. It invokes only the
  fixed pure format-library parser on the current scope, or on an optional `path`
  selected with the same safe JSON Pointer semantics. An unavailable selection,
  including a missing wildcard source, fails before the fixed parser; actual empty
  collections and null are valid. No-selector behavior is unchanged. This makes every
  schema-native cross-field constraint reusable as a rule, including nested
  `each` conditions. It fails closed without a format validator. It cannot run
  evidence checks or scripts, mutate output, or select an unknown parser.

For example, `{compare: {left: {sum: [{path: "/x"}, {path: "/w"}]},
op: "lte", right: 100.5}}` checks a crop boundary. `{path: "/edges", unique:
true, by: ["/source", "/target"]}` checks directed endpoint pairs. A custom
schema can reuse all QA scope semantics with a rule whose `require` is
`{conforms: "qa-scope-v1"}`. The same data format can be evaluated by a future
Check step without allowing arbitrary code.

Configuration size/depth, wildcard expansion, condition nesting and actual work
are bounded. One evaluation permits at most 100,000 condition visits and
1,000,000 charged work units. Work includes inner collection scans, pointer
traversal, comparisons, key sorting, string characters, canonical serialization
and the argument/refinement cost of fixed format predicates. Collections and
selections are capped at 20,000 entries, data depth at 48, condition depth at 12,
and canonical/configuration strings at 1,000,000 characters. Configuration is
also limited to 50 rules and 10,000 data nodes. Limits are fixed, not recipe settings.
Native evaluation yields between 2,048-unit slices and honors cancellation;
synchronous package APIs use the same total-work accounting. Lazy named-context
conditions inspect only selected sources rather than hydrating unrelated history.
All conditional reads in one binding pass share the same remaining work budget.
A limit violation rejects output through correction; it never converts uncertainty
into success. Large nested lookups may exceed the budget even when each individual
collection fits: use a simpler rule or smaller output instead of increasing limits.

## Explicit output protocols

An ordinary custom `questions`, `questionChoices`, `questionRecommendations` or
`architectureRevision` field is data, regardless of the step's ID. Human-question
metadata is normalized only for `askQuestions`, a configured question-bearing
check (`optional-questions`, architecture candidate, inventory or impact), or an
intended question-bearing library format. A format selects validation; it does not
by itself add a human pause. Existing question actions remain explicitly configured.

Architecture handback opts into `checks: ["architecture-revision"]`. The same
lexical graph must contain a configured architecture decision with a valid proposal
revision route. With multiple decisions, bind `reads.architectureDecision` to the
intended decision. A true `architectureRevision` then returns to that decision's
declared proposal route, retaining review/acceptance requirements. Stock steps
declare the check explicitly; the old-definition adapter derives it only from
the historical accepted local decision graph. Stored definitions and output
receipts are never rewritten to enable compatibility.

## Invariant inventory and compatibility

The library retains existing parser refinements. The following inventory records
where each family is enforced and how it is reusable through rules. Keeping these
checks in their original parser preserves normalization, exact output shapes and
correction behavior; evidence-dependent hard failures remain at their old stage.

| Existing invariant family | Format / rule representation |
| --- | --- |
| Implement blocked/completed questions; fixer architecture handback; completed review has no blockers; blocked/failed review has a recovery reason | Stock `when`/`all`/`any`/`empty` rules, with unchanged messages |
| Visual `changed` versus area inventory; representative state count/budget; reason above the normal budget; unique area/state names | `visual-scope-v1`, `legacy-video-scope-v1`, `qa-scope-v1`; `count`, `compare`, `length`, `each`, `unique`, `conforms` |
| QA unique story/criterion IDs; empty-story reason; screenshot-task uniqueness, selected area/state references and complete story linkage | `qa-scope-v1`; tuple uniqueness, set membership, `conforms` |
| Video unique task IDs; unique/existing story and criterion references | `qa-scope-v1`; `unique`, `within`, `conforms` |
| Generated chapter guides: unique chapter/system IDs, nonvisual map requirement, 3–6 lanes, visual scope exclusion of logic, lane/edge/part references, directed-edge uniqueness and chapter links | `generated-guide-v1` and the unchanged generated-guide/coverage evidence adapter; `when`, tuple uniqueness, membership, `conforms: "generated-guide-v1"` for authored constraints; `guide-v1` remains the readable historical shape |
| Review brief crop x+w/y+h limits; required story/tour by version; unique tour files, requirements, flows and participants; participant/requirement references; table row widths; gap readiness; flow reference/index bounds | `review-brief-v1/v2/v3` and `generated-review-brief-v1/v2/v3`; sum/length comparisons, `distinct`, tuple uniqueness, `sameLength`, `lookup`/`maxItem`, `conforms` |
| Review brief recursive prose restrictions with receipt/file-field exceptions | Versioned review-brief `conforms`; fixed text predicates for selected custom fields. The parser retains its exact traversal exceptions |
| Architecture candidate deliverable/criterion uniqueness and trace coverage; check-in version/talk/check references/map cap; meaningful-choice map/decision requirement; decision/option uniqueness and picks/leans/attribution; map area/part/link references; preview new/hide/link rules | `architecture-v1`, `architecture-brief-v1`, `architecture-checkin-v1`; conditional presence, counts, membership/disjoint/uniqueness, `conforms` |
| Architecture candidate review approved/feedback/questions/continuation consistency | `architecture-review-v1`; conditional emptiness/presence, `conforms` |
| Question option/default uniqueness and valid IDs; single-selection default limit; nonblank questions; recommendation/choice unique in-range indexes and mutual exclusion | `question-fields-v1` / `question-choices-v1` plus existing question-bearing formats retain `normalizeQuestionResult`; `unique`, `within`, counts/length comparisons and nonblank text. Question metadata validation remains automatic for any generic output declaring questions |
| Delivery target URL credentials/origin/path coordinates; delivery mode/targets; globally unique target/operation/criterion IDs and resources; required capabilities, before-state fields and supported/target-bound relationship mutations | `delivery-contract-v1`; `conforms` retains URL parsing and complete semantic checks, with ordinary uniqueness, membership and conditional rules available separately |
| Impact dependency path restrictions; duplicate specialists/checks/feedback IDs; status/questions and assessment consistency | `impact-v1` retains its schema; `impact-reuse` retains independent snapshot/receipt comparisons and their original failure stage |
| Specialist/inventory/coverage unique IDs, active references, accepted skip decisions, later-stage obligations, consequential-finding evidence and stable reopening/dispositions | Versioned `inventory-v1`/`specialist-v1`/`coverage-v1` are usable as standalone pure schemas; explicit `inventory-evidence` / `specialist-evidence` (with optional `coverage: true`) adapters compares the bound inventory, rounds and original receipts. Pure uniqueness/membership/conditional constraints are reusable rules |
| Improvement reserved identifiers, unique research assignment IDs, approved/feedback consistency; retained settings/destination/item-choice/opportunity/package/action schemas | Versioned improvement formats, `unique`, conditional emptiness and `conforms`. `dependency-graph-v1` checks complete projected ID/prerequisite lists through the generic Check before approval; raw legacy formats remain data-only |

Historical result parsers sometimes accept readable older artifacts more broadly
than newly authored guides. The authored-guide adapter keeps enforcing its richer
schema at output correction; a readable historical format never bypasses that
check. No new generic rule replaces receipt authenticity, human approval or live
provider evidence.

## Evidence checks

Checks come from a fixed code-backed library. Generic selector arguments use
JSON Pointers with `*` expansion:

```json
[
  {"check":"files-exist","path":"/files/*"},
  {"check":"code-refs-valid","path":"/references/*"},
  {"check":"ids-resolve","path":"/requirementRefs/*","source":"inventory","ids":"/requirements/*/id"},
  {"check":"media-valid","path":"/images/*","kind":"image"}
]
```

Files are confined to the configured repository; bound checks read the pinned
Git revision. Code references are `file:line[-line]` or
`{file,line,lineEnd?,repositoryId?}`. IDs resolve against a named read. Media uses
the current screenshot validation or video probing/size/time/codec limits and
must remain inside the run's evidence directory. These generic checks participate
in output correction.

Stock checks without selector arguments must declare a compatible `adapter`: `capture`, `guide`, `qa-scope` or `qa-gate` for the four generic checks. An unusable bare selector is rejected at save. Other fixed checks use their existing contract adapters:
`requirement-coverage`, `delivery-contract`, `qa-environment`, `qa-evidence`,
`feedback-assessment`, `review-dispositions`, `inventory-evidence`, `specialist-evidence`, `architecture-proposal`,
`architecture-candidate`, and the stock `media-valid` / `code-refs-valid` /
`ids-resolve` modes. They run at their existing authoring, finalization or gate
stage, preserving their retry and failure behavior.

`impact-reuse` is one evidence check, never a step type. Generic revision binding
and reads express its output freshness and sources. Its live multi-repository
snapshot, target ancestry/overlap, original receipt/boundary fingerprints, active
requirements/reviewer/check identities, downstream obligations and cross-round
convergence cannot be inferred from JSON output alone. `Impact.ts` retains those
comparisons and re-verifies reuse at each consuming gate. Moving its hard failures
into output rules would change old retry semantics, so this release does not.

`ticket-milestone` declares plan/implementation reporting at the existing publication stage. Its `kind` is `plan` or `implementation`; old custom roles retain reporting independently of whether they had a Factory output schema.

`optional-questions` retains the old fixer behavior: ask only when an optional questions array is returned. Selecting the fixer output schema alone does not add a human wait. `qa-review-evidence` owns capture/scope revision stamping for QA reviews; selecting its output schema alone never manufactures an acceptance receipt.

`review-boundary` explicitly activates independent review baselines and reviewer fanout constraints; named inventory reads alone remain ordinary inputs. `capture-evidence` explicitly activates capture finalization and provenance. A generic read of `@qaReuse` alone adds context without finalizing media. `impact-boundary` declares consumption of independent impact evidence; a generic input named `impact` alone never adds rerouting or a gate.

`scope-inputs` declares the named reads that define accepted requirement scope.
Its `sources` map names stable digest fields and the corresponding read names.
Review/impact/guide steps share that scope independently of their other inputs.

## Old definitions and editing

Unversioned accepted workflows register legacy interpretation in a WeakMap. Old
contract flags are a deterministic old shape; an explicit modern workflow or
step marker wins. Historical IDs are interpreted only at that legacy boundary.
Native sessions, accepted definitions, stock recognition/visit-budget digests and
old prompt bytes are not rewritten. Transient runtime step copies inherit their
registered scope.

The Recipes editing projection materializes **all** resolved old configuration
before a setting is edited. It therefore cannot drop old validation when someone
adds one optional field. Existing persisted runs retain their original graph.
New unconfigured workflows and new steps in old recipes are explicitly modern.
The explicitly flagged old improvement routine retains its historical template-role
lookup inside this same compatibility module. Ticket 6 owns replacing that routine;
no new generic agent behavior infers those template roles from an ID.

## Dependency verification

Ajv is an owning edge-worker dependency at 8.20.0; its redundant workspace override
was removed. The MCP SDK bump also makes the Hono and node-server overrides
redundant, so they were removed; natural resolution selects Hono 4.13.13 and
node-server 2.1.5. The required audit exposed existing advisories: owning MCP SDK
consumers now use 1.32.1, and test consumers use Vitest/UI/coverage 4.1.12. Vite is
explicitly declared as the edge-worker's compatible Vitest peer at ^8.3.5 because
bumping Vitest and refreshing transitive resolutions retained the vulnerable
auto-installed peer. This resolves the patched graph naturally without a Vite
override. Axios 1.20.0 naturally resolves patched follow-redirects 1.16.1. The
existing telemetry override remains within its compatible patched 2.x major.
`pnpm install` and `pnpm audit` verify the resulting lockfile; the final audit has
zero advisories.

## Check steps (Taskbot #137)

`type: "check"` uses the same `reads`, `checks` and `rules-v1` conditions. It
runs no agent and invokes no action. Its `check` configuration declares named
results and an optional final `passed` condition:

```json
{
  "id": "inspect-results", "name": "Check results", "type": "check",
  "configVersion": "step-config-v1",
  "reads": { "reviews": "parallel-review" },
  "check": {
    "results": {
      "openFindings": {
        "aggregate": "filter", "path": "/inputs/reviews/*/*/findings/*",
        "where": { "all": [
          { "path": "/status", "equals": "open" },
          { "path": "/rating", "min": 2 }
        ] }
      },
      "approved": {
        "aggregate": "all", "path": "/inputs/reviews/*/*",
        "require": { "path": "/approved", "equals": true }
      }
    },
    "passed": { "all": [
      { "path": "/results/openFindings", "empty": true },
      { "path": "/results/approved", "equals": true }
    ] }
  },
  "branches": [{ "when": { "path": "passed", "equals": false }, "next": "correct" }],
  "next": "publish"
}
```

This example assumes `correct` and `publish` exist in the same recipe. Paths and
wildcards are generic: the same expressions work over current Parallel outputs
and future item-result collections; this release does not add For each.

Every named expression sees `{inputs, evidence}`; the final `passed` expression
also sees `results`. A normal condition produces a boolean. `aggregate` supports
`all`, `any` (required `require`, optional `where`) and `count`, `filter` (optional
`where`). `{select: "/inputs/source/field"}` projects any JSON value, with an
absent value represented as `null`. An aggregate must select a real array; missing
and malformed paths fail instead of passing as an empty collection. Empty arrays
produce all=true, any=false, count=0 and filter=[]. Without `passed`, all emitted
boolean results must be true and at least one boolean is required. Select-only
and count/filter-only configurations require an explicit `passed` condition.
Result names are unique object keys, bounded to 80 characters; `passed`,
`__proto__`, `prototype` and `constructor` are reserved. At most 50 results share
one fixed evaluation budget, including output projection and serialization.

The evaluator uses selected data only: unrelated large baselines or lazy history
are not traversed to evaluate an ordinary condition. Selected properties must be
own JSON data, never accessors, arbitrary prototypes or custom iterators. Actual
pointer expansion, collection scans, comparisons, projections, strings and output
serialization are charged; selected cycles fail. Native and HTTP simulation use
the same yielding/cancellable implementation and existing total limits. Known
host ticket `createdAt`/`updatedAt` timestamps use ISO strings for Check reads both
before and after restart; this does not permit arbitrary `toJSON` execution.

Check can declare `files-exist`, `media-valid`, `code-refs-valid` and `ids-resolve`
with explicit selectors rooted at `/inputs`. These execute the fixed evidence
library before any predicate can pass and retain bounded traversal and
cancellation. `ids-resolve` names a declared `reads` source and an `ids` pointer
within that source. A bound Check verifies repository files/references at its
pinned inspection revision. Unsupported agent/action protocols are rejected;
agent-output `rules` belong on agent nodes, while Check predicates belong in
`check.results` or `check.passed`. Simulation requires an explicitly successful
synthetic `{ "verified": true }` receipt for each selector check, and performs no
live evidence I/O.

Fixed `review-evidence`, `qa-gate-evidence` and `delivery-evidence` declarations
project verified facts. A binding named `review`, `scope`, `capture`, `impact` or
`qaReuse` alone never activates them. QA retains exact producer/frame revisions,
clean HEAD, scope/capture/review digests, original criterion receipts, environment
probes, screenshot bytes/acceptance and video evidence. Specialist evidence retains
original inventory, reviewer stamps, ledger/dispositions, settled findings,
disagreements and required coverage. The complete immutable specialist receipt is
stored on the exact Check history entry's `evidence` field; pure results do not
copy its full baseline. Consumers authenticate that exact configured Check/frame
and the original approval, never an ordinary role-shaped result. Grouped consumers
project the original receipt with the same repository evidence rules.

`review-assistance` explicitly enables the existing checkpoint protocol for
`approved`, `findings`, `reviewIncomplete`, `reviewBlocked` and `questions` results.
It keeps unchanged-fix/instruction fingerprints, waits and native conversation
identity in runtime bookkeeping. QA recovery validates its declared capture →
review → Check path; ordinary branches name every recovery destination.
Read-only `review-evidence` and coincidental result names do not enable assistance.
An incomplete specialist review routes to its declared impact assessor before a
product fixer. Native continuation and visits belong to the selected destination:
retrying the reviewer retains its session, while another agent uses only its own
saved session or starts independently.

Accepted impact outputs stay immutable while runtime decisions track selected
checks and pending reviewers separately. Retained snapshot reconstruction uses
the authenticated original aggregate from its exact producer, frame and round.
The declared independent impact protocol may inspect that original inventory as
historical evidence with its original binding retained. Consuming a reused
inventory additionally requires the exact current scope-reuse decision and
derivative marker, unchanged repository binding and fresh scope/target/environment
evidence. New answers require independent reassessment; ordinary reads retain
their normal effective-input freshness checks. Reuse never claims a fresh
extraction or grants review/approval.

`post-fix-evidence` requires a `reads.observation` binding to the exact executed
`inspect-review-readiness` action in the current frame. Its stock rules inspect
factual observations (including grouped collections); unchanged failures/revision
mismatches/actionable work enter assistance without waiving review or CI.

Stock contract freezing is the explicit `accept-delivery` action followed by a
Check. Provider inspection is an explicit `inspect-review-readiness` action
followed by a Check. CI, queued-fixer readiness, publication, handoff, human gates,
merge and external apply/verify/final checks retain their action safeguards.
Historical `review-gate`, `visual-gate`, `delivery-mode`, `delivery-route` and
`review-after-fix` definitions still load and resume through their existing
code-backed deterministic handlers; they are absent from the new-step palette.
Accepted definitions, state, completed receipts and native sessions are not rewritten.

Recipes provides structured nested conditions, collection/selection results,
named reads, evidence declarations, routes-on summaries and a JSON fallback.
Invalid rules disable Save with an explanation. The simulator calls the same
production HTTP evaluator/branch function and clearly labels supplied evidence as
synthetic fixtures: simulation cannot authenticate real files, receipt provenance
or human approval. Undeclared fixture evidence is rejected.

Agent-facing context uses [bounded nested views and paginated original evidence](context-memory.md). Declared reads retain their complete native values for Check and revision binding; transport references do not grant approval or producer ownership.
