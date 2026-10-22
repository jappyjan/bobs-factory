# Implementation verification packet — #141

Base freshly fetched before publication:92cdb8227468a596686fc7cdcc1ef06a0894c4af,
treeb808a78f4e95f463b0285808141c5eb929e022d2. Actual checkout
`/Users/jappy/.t3/worktrees/bobs-factory/taskbot-141-improve`, branch
`taskbot/141-improve`. Node24.21.0 / pnpm10.33.1. Coordinator binding and prior
implementation/review worktrees were untouched. No dependency/lockfile change.

This is implementation evidence; independent Standards/Spec acceptance, status
changes and guarded merge belong to the parent. CI and broad checks are
**DEFERRED** under epic135's 2026-10-22 user policy. No CI was inspected,
triggered, retried or watched. No native binary build or production service.

## Focused results

Owning test command prefix: `pnpm --filter bobs-factory-edge-worker exec vitest run`.
Runs below are separate focused executions, not a combined-suite claim.

| Scope | Actual result |
| --- | --- |
| `test/ImproveRecipe.test.ts` mixed-flow case | 1 passed/1 skipped,23.52s; [receipt](composed-final.txt). Actual WorkflowRuntime with controlled agents/actions proves eight perspectives,14 worker calls with partial failures, concurrency≤4, Ask→reconsolidate without replay, stable IDs, failing review→refine, Request changes→Decide with feedback, exact persisted batch after reconstruction,1 issue,2 dependency-ordered children and original receipts. |
| Same file, edited-fork case (separate run) | 1 passed; edited perspective, copied prompt and renamed coordinator execute. The initial mixed-flow failure in that run was fixed and separately rerun above. |
| `test/View.test.ts test/DeclarativeView.test.ts` | Helper:115 passed; bounded collection projections, scope/malicious pointers,0–5 items, final schema validation. |
| `test/ResearchPermissions.test.ts test/FactoryActionEditor.test.ts test/FactoryWebClient.test.ts test/FactoryViewIntegration.test.tsx test/prompt-assembly.routing-context.test.ts` | 5files/71 passed. Routing capability was subsequently cleaned of the old hidden-model/action paragraph; its complete-prompt5 tests passed again as part of the final prompt run. |
| `test/FactoryRolePrompts.test.ts` | 2passed after intentional current-stock fixture update; all579 protected legacy/conservative/other-stock entries are unchanged.639 full current/frozen prompt entries asserted, including nested body agents. [Preservation](prompt-preservation.json), [receipt](prompts-final.txt). |
| `test/StepConfig.test.ts` | 12 passed. Removed obsolete settings/action samples; pure library shapes remain. |
| `test/FileIssues.test.ts` | 6 passed against renamed generic provider adapters. |
| `test/SnapshotCallMapping.test.ts` | 14 passed; unchanged generic trusted provenance retained. |
| `test/ResearchFormats.test.ts` + two trigger/legacy-normalization cases in `WorkflowRuntime.test.ts` | 4passed/136skipped; [receipt](formats-legacy.txt). The first owning runtime suite had136passed/2failed obsolete Improve-trigger expectations, now updated and focused-passed. |
| New modern fanout ownership + every-bundled-fork cases | 2passed/156skipped; [receipt](ownership-fork.txt). Modern branches project only produced outputs; legacy fanout aliases are explicitly retained. Fork closure includes bundled Factory/Takeover; only Simple refused. |
| Empty File issues action boundary | 1passed/21skipped; no destination lookup or send; [receipt](empty.txt). |
| Actual EdgeWorker/F1/CLI | Three groups passed; see [F1 report](../../../2026-10-22-improve-blocks.md), actual HTTP/provider/tracker/history receipts in parent directory. |
| Types/build | Initial root owning type check and helper UI checks were blocked by missing workspace declarations. Built missing JavaScript dependencies, then owning edge build and later edge TS compilation passed. View helper focused types passed. Web shell build passed after palette CSS fix. Normal commit hooks are recorded separately when run; no manual broad build/type replay. |
| Changed-files Biome / whitespace |39files,exit0,31 CSS specificity warnings/no errors; [receipt](biome.txt). Three import/format errors were corrected before the final check. `git diff --check` passed. |

The runtime test's dependency child is an explicitly controlled accepted test
definition; its scripted action supplies exact human/provider merge proof. It
does not autoapprove a production Factory child. The separate F1 drive admits
the ordinary stock Factory graph, which remains at clarification with zero
child human decisions. Mock configuration evidence is not native enforcement
or native conversation/restart QA. No paid or tracker-network effects occurred.

## Audit and deletion/test changes

The complete source location inventories are [before](improvement-before.txt)
(280 matches) and [after](improvement-after.txt)(34 matches); every matching
location is retained, text capped at240 columns. These are source inventories,
not zero-grep claims. Historical raw fixtures/test-drives remain untouched.

- Deleted ImprovementRuntime, Improvement settings/state/action helpers, old
  server/runtime hooks/endpoints, preflight worker-model requirement, run fields,
  dedicated web screen and931lines of orphan screen CSS. Deleted733line
  `Improvement.test.ts`, whose subject was the removed executor.
- Preserved shared actual read-only/context permission enforcement; generic
  Gemini access now rejects unsupported read-only use before a turn. Kept all
  generic consumers and moved shared tracker creation into FileIssueProviders.
- Remaining Improve references are recipe/library identifiers, the eight original
  perspective prompts/architectural filter, generic format aliases preserved for
  accepted other forks, user-facing text and immutable legacy fixtures. No
  improvement flag, step-ID/format privilege, special orchestrator or state route.
- Obsolete trigger expectations now assert ordinary recipe defaults. Pure output
  formats retain compatibility, while removed settings/choice schemas are no
  longer advertised. Complete prompt assertions reflect the new capabilities;
  stock role fixture removes old stock executor roles, adds generic callable
  and nested-body roles, and preserves all579 protected entries byte-for-byte.
- UI tests now exercise generic child links/callable palette/fork behavior rather
  than deleted Improve projections. New runtime/view/action tests protect actual
  boundaries: produced-output ownership, restart/stale decisions/partial success,
  selected plan coverage/refinement, empty side effects and reachable fork closure.
- Narrow generic fixes discovered by the real drive: optional initial Call reads
  use declared callee inputs; explicit fanout emits produced outputs; approval
  cards bind parsed reviewText including criteria/dependencies/paths. No other
  security/outcome assertion or existing timeout was softened. The new combined
  scenario has its own90s bounded test timeout.

After the last F1 runtime source hashes were captured, changes were limited to
palette scrolling CSS, removal of the stale capability paragraph, the matching
full-prompt expectations/fixture and documentation/evidence/import formatting.
These do not change the tested graph, execution rules or provider permissions.
