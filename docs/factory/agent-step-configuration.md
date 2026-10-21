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
Ajv draft-07 validation at save, with no remote `$ref`, at most 64 KiB, bounded
nesting and pattern sizes. Schema validation never fetches references or executes
user scripts. Invalid schema or rule output enters the existing bounded output
correction loop. The builder validates against the same server implementation.
Unknown format, check, instruction and rule-format IDs are rejected at save.

`revision: "bound"` records repository revisions and a digest of the declared
inputs. A changed revision or input invalidates reuse and reruns the step. Access
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
  fixed pure format-library parser on the current scope. This makes every
  schema-native cross-field constraint reusable as a rule, including nested
  `each` conditions. It fails closed without a format validator. It cannot run
  evidence checks or scripts, mutate output, or select an unknown parser.

For example, `{compare: {left: {sum: [{path: "/x"}, {path: "/w"}]},
op: "lte", right: 100.5}}` checks a crop boundary. `{path: "/edges", unique:
true, by: ["/source", "/target"]}` checks directed endpoint pairs. A custom
schema can reuse all QA scope semantics with a rule whose `require` is
`{conforms: "qa-scope-v1"}`. The same data format can be evaluated by a future
Check step without allowing arbitrary code.

Configuration size/depth, wildcard expansion, condition nesting and the total
number of evaluation operations are bounded. A limit violation rejects output;
it never converts uncertainty into a successful check.

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
| Improvement reserved identifiers, unique research assignment IDs, approved/feedback consistency; retained opportunity/package/action schemas | Versioned improvement formats, `unique`, conditional emptiness and `conforms`. DAG/choice/package validation remains fixed runtime behavior for the existing improvement routine; ticket 6 owns rebuilding that routine |

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
