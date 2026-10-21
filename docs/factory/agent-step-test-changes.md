# Configurable agent-step compatibility evidence

Taskbot [#136](https://taskbot.apps.janjaap.de/p/bobs-factory/t/136), part of
[epic #135](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135).

The existing assertions about approval, retries, failures, revision identity,
evidence, concurrency and recovery remain in place. Changes below replace old
mechanisms or correct fixtures that formerly relied on implicit step IDs.
Assertions comparing removed contract flags now compare their explicit format or
evidence-check configuration. Operational readiness lives on `run.mergeReadiness`,
independently of any authored output key.

Direct tool-unit tests deliberately bypass the runtime loader. Their old-context
helpers therefore model that loader's historical interpretation explicitly. This
is separate from the production-loading proof in
`LegacyStepConfigResume.test.ts`: it writes the unmodified historical definitions
from `legacy-workflows-a4990127.json` into persisted run state, then loads and
resumes them through `WorkflowRuntime`, without a test-side registration call.

| Existing test file | Mechanism change and retained safeguard |
| --- | --- |
| `Architecture.test.ts` | Check explicit proposal evidence instead of removed flags; old planning-upgrade fixtures remove the modern version marker when replacing their graph with historical steps. Model preferences and authorization assertions remain. |
| `Checkin.test.ts` | Select the configured proposal format and compare the entire rendered instruction template to the same check-in prompt. |
| `CISupervision.test.ts` | Read operational readiness from the runtime field; retain failed-CI, repetition and approval outcomes. |
| `DeliveryCoordination.test.ts` | Direct old review-after-fix contexts pass through the old-context fixture helper; publication and queued-fixer outcomes stay the same. |
| `EdgeWorker.capture-recovery.test.ts` | Give direct native contexts their missing agent type and historical interpretation, and model loader readiness migration. Preserve every correction/restart assertion; add a generic inline-schema/rule correction regression using the same native conversation and bounded retry budget. |
| `EdgeWorker.merge-recovery.test.ts` | Existing assertions are unchanged; add renamed merge recovery after worktree deletion. |
| `FactoryConfigProjection.test.ts` | Compare the complete editing projection with materialized config, accepted step presentation metadata, and the modern marker on newly saved recipes. Retain atomic save and restricted-response assertions. |
| `FactoryPipeline.test.ts` | Direct old contexts declare their accepted old graph; old screenshot-only scenarios use historical definitions rather than deleting removed flags from modern presets. Custom gates declare reads. Operational readiness assertions move to its runtime field. Review, QA, assistance and handoff outcomes remain. |
| `FactoryPush.test.ts` | Synthetic readiness is supplied through its operational field; attention, recovery, approval and publication assertions remain. |
| `FactoryProvenance.test.ts` | Use the maintained five-second runtime transition helper for the two persisted waiting-state observations; a loaded full run exceeded the former one-second allowance. Build identity, immutable definitions and retained-receipt assertions remain. |
| `FactoryRepositoryScope.test.ts` | Register direct old graph contexts, retain legacy interpretation on transient copies, and dispatch scripted specialist results by format. Multi-repository revision and file assertions remain. |
| `FactoryReviewState.test.ts` | Add root/child/sibling revision-collision regressions for stock and renamed guide output keys. Modern views resolve only the exact declared `outputRoles.guide` slot; historical cached views without role metadata retain the existing nested-guide compatibility assertions. |
| `FactoryRenamedPresentation.test.ts` | Persist exact called-frame output slots with completed producer-history records, matching the runtime's ownership proof. Retain missing-artifact-chunk, hash, screenshot/media-route, and stock-versus-renamed retrieval assertions. Unexecuted synthetic leaf receipts no longer grant a presentation role. |
| `FactoryRenamedSteps.test.ts` | Real asynchronous revision snapshots may start independent specialist groups in either order. Compare only contiguous visits within the declared one-step specialist fanout as an unordered phase; require every declared specialist exactly once. Preserve exact serial boundaries, all tool commands, publication, QA, explicit approval, completion, and confirmed merge assertions. |
| `FactoryRolePrompts.test.ts` | Expand declared snippets before full prompt comparison; retain the immutable base-captured role fixture and add full-string generic snippet order/slot assertions. The separately tested capability reference is intentionally updated for the new settings. |
| `FactoryServer.test.ts` | Image and retained-guide fixtures declare their actual accepted called-frame slots and completed producer records. Preserve all image traversal, symlink, hash, adjacent-guide, and compact-history assertions; also reject a later unrelated guide receipt sharing the same leaf name and prior head. |
| `FeedbackPolicy.test.ts` | Supply the explicit feedback check, reads and accepted nested graph corresponding to its historical receipts. Policy authenticity and recovery outcomes remain. |
| `GitProvider.test.ts` | Register the direct pre-config provider context as an old accepted step, preserving historical repository metadata compatibility. Provider pinning, selected-remote validation, unknown-host rejection and retry assertions remain unchanged. |
| `GitService.github-auth.test.ts` | Add generic repository-output and frozen selected-repository credential regressions. Existing origin, push destination, native credential and grouped runner assertions remain unchanged. |
| `Guide.test.ts` | Build old upgrade fixtures from the real frozen definitions instead of current modern presets. The full expected old/upgraded guide prompts remain. |
| `Impact.test.ts` | Direct QA probe/reuse helpers declare capture output and scope/capture/gate bindings instead of borrowing an unrelated inventory role; post-run direct tools use the accepted loaded definition. Original provenance, changed-fixture and failed-reuse assertions remain. Real Git comparison/restart scenarios receive 120 seconds per case and 30 seconds for retry completion: isolated retry cases took 9.9/13.7 seconds, while concurrent checks exceeded the former 10/30-second fixture allowances. The convergence-recheck durability case also allows 30 seconds for its three-round waiting transition and subsequent held correction; the full run exceeded the helper's five-second observation allowance. Its existing 30-second test budget and all receipt/convergence assertions remain unchanged. No runtime budget or outcome assertion changes. |
| `Improvement.test.ts` | Use the maintained runtime transition helper for the invalid-proposal failure observation that exceeded its former one-second fixture allowance under load. Invalid dependency rejection and successful research reuse assertions remain unchanged. |
| `Incremental.test.ts` | Model the direct historical capture role and supply the base revision through the declared CI read; preserve complete PR-file and incremental revision assertions. |
| `MergeReadiness.test.ts` | Direct tool contexts model a loaded historical graph, and readiness assertions use the operational field. All discussion pagination, feedback, retry, CI, approval and repetition assertions remain. |
| `ResultArtifacts.test.ts` | The direct guide role declares its format, guide checks and capture/scope/review reads. Large artifact and validation assertions remain. |
| `ReviewBrief.test.ts` | Distinguish configured brief versus readable legacy guide output and declare the handoff's guide read. Brief normalization, correction and Markdown assertions remain. |
| `ReviewFiles.test.ts` | Current guide fixtures retain the exact `pipeline/guide` output and completed producer history. Missing producer history now rejects the unrelated output; a historical guide without adjacent bound CI/handoff still rejects reconstruction. Existing HTTP authorization, snapshot identity, immutable-byte and historical revision assertions remain. Add actual validated-run root/sibling guide collisions and same-frame historical receipt tests. |
| `ReviewRecovery.test.ts` | Direct contexts declare review, gate and fix bindings. The raw specialist recovery fixture retains the completed specialist receipts that the real runtime writes before a fanout aggregate. Dispositions, failure and assistance assertions remain; modern self-stamped raw slots reject, and a separately registered historical step retains old raw recovery. |
| `SpecialistReview.test.ts` | Direct contexts declare their role and partner bindings; called QA fixtures keep the frame's bound outputs coherent with the authored evidence. Aggregate freshness, nested association and independent-review assertions remain. |
| `StepVisitBudget.test.ts` | Construct old stock from the actual historical definitions before restoring its old budget. Preservation, one-time allowance and custom-budget assertions remain. |
| `ToolBindings.provenance.test.ts` | Configured repository selection uses the frozen selected repository record instead of a writable ordinary output. Actual validated generic `repository` producers cannot select a provider; selected repository identity, executed publication ownership and cold-read assertions remain. |
| `Video.test.ts` | Declare the capture self-read used by finalization; add a renamed capture media route and rejection of a stray historical key. Media limits and provenance assertions remain. |
| `WorkflowCatalog.test.ts` | Historical replacement graphs remove the modern marker; assertions compare the configured inventory/brief/video settings. Saved preferences and upgrade behavior remain. |
| `WorkflowRuntime.test.ts` | Custom human-review fixtures declare their guide read; generic assistance fixtures declare `askQuestions` instead of receiving it implicitly from a fixer-like ID. Assessed-correction cases inspect the exact `pipeline/ci-fix` receipt after modern call frames became isolated; correction execution, skipped obsolete work, required independent review, frozen definitions and absence of human approval assertions remain unchanged. Original question/recheck and guide-only regeneration outcomes remain. |
| `fixtures/legacy-review.ts` | Remove the modern marker when constructing an intentionally historical graph. |
| `prompt-assembly.routing-context.test.ts` | Update the entire expected capability-reference paragraph for reads, formats, rules, checks, revisions, access and shared instructions. All full-prompt assertions remain. |
| `packages/mcp-tools/test/factory-operator-recovery.f1.test.ts` | Allocate an explicit free loopback port: the historical zero-port option selected port 3456, which collided with an unrelated running F1 server. Retain the entire compiled-stdio recovery scenario and its assertions. |
| `packages/mcp-tools/test/factory-operator.integration.test.ts` | Give the actual compiled Node CLI startup a 30-second test allowance instead of the default five seconds under concurrent package-suite load, and register cleanup before connecting. Tool discovery, inspect and revocation assertions are unchanged. |
| `apps/f1/test-drives/assets/desktop-shell-update.mjs` | Await the fixture's existing asynchronous save before capturing the waiting-state bytes. The concurrent script sweep captured the earlier running snapshot before the queued waiting snapshot finished. Exact byte-preservation, ownership, recovery and suppression assertions are unchanged. |

New focused regressions cover safe schema/rule validation and unknown IDs,
format-only modern roles, stock-versus-every-step-renamed Factory, raw frozen-run
resume, multi-repository evidence, pinned read access, stale producer/input/tree
bindings across restart, and renamed presentation/media/artifact retrieval.

The R6 review reproduction used the same run through raw, dashboard, and focus
HTTP responses: raw state reported a current pending Build while the dashboard
omitted `mergeReadiness`. The fix projects a bounded runtime-owned readiness view
and makes it authoritative in both the working row and review checks. The
regression tests poll stock and fully renamed Factory runs before and after the
Build completes, retain an older successful CI receipt, and verify rendered
pending blockers and passed checks. Provider discussion bodies stay outside the
dashboard projection.

The R7 review controls previously inferred refresh eligibility from the current
step's name, while phase, icon, and fixing labels inferred roles from historical
IDs. The API now exposes `reviewCapabilities.refreshGuide` from the same accepted
graph resolver used by the mutation. Configured role metadata travels with the
accepted workflow and current step. `FactoryOperationalPresentation.test.ts`
covers a valid guide gate renamed to `external-human-review`, an arbitrary pending
gate, the unsupported stock external gate, stale review IDs, rendered action
visibility, and capability removal on the next poll after refresh. Stock and
fully renamed role presentation are equal; generic steps with historical names
stay generic. Approval and refresh mutation guards remain in force.

See the [F1 report](../../apps/f1/test-drives/2026-10-21-configurable-agent-step.md)
for executable workflow and browser evidence. Final complete gate output is
retained beside that report under its assets directory.


## R1: inline schema execution isolation

`FactoryStepConfigApi.test.ts` retains its complete unknown-ID and normal schema
assertions and adds unsafe `pattern`/`patternProperties`, cyclic-reference, HTTP
save rejection, and concurrent HTTP responsiveness cases. A real expensive Ajv
meta-schema compile runs during the responsiveness assertion.

`EdgeWorker.capture-recovery.test.ts` retains all existing contract/correction
assertions and adds a saved native result whose schema validation exceeds its
resource budget. It verifies one correction in the original conversation and
verifies that cancellation spends no correction attempt or native turn.

`InlineSchema.test.ts` adds real compilation and validation deadline probes,
main-thread heartbeats, local-ref/pattern guards, useful ordinary schemas,
cancellation, and bounded queue recovery. The compiled Bun smoke fixture exercises
normal async and synchronous validation, cycle rejection, an OS-killed pathological
regex with a responsive parent, cancellation, and a subsequent successful job.
The workflow capability expectation changes by the exact new restriction sentence;
the surrounding full-prompt assertion, including merged storage guidance, remains
unchanged.

The Node 22 CI-only failure was a test timing assumption: a valid 4,400-item enum
compiled within the production 250 ms allowance (231–241 ms in a Node 22.23.3
probe), so successful validation was correct. The HTTP test now requires a
concurrent response while compilation is pending, bounded completion, and either
an exact successful result or a specific resource-limit error. The compile guard
test uses the engine's existing 1 ms execution-budget parameter to interrupt real
Ajv compilation independently of CPU speed. Actual regex, native correction and
queue-limit assertions retain their production budgets. Unknown schema keywords,
format/check/instruction IDs, unsafe patterns and cycles remain rejected by the
same assertions. A new successful HTTP save also exercises asynchronous compilation
followed by cached synchronous catalogue validation.

## R3/R4: effective inputs and original inspection snapshots

`RevisionBinding.test.ts` retains the original binding/restart/producer assertions
and adds a check that refreshing a producer executes the intervening mutator only
once. New cases cover optional-read agents receiving changed answers and prior
outputs, called frames, concurrent input/repository changes, normal persisted-run
loading and retry, configured execution redaction, and bounded stale native turns.
`RevisionBinding.input-history.test.ts` reproduces and prevents a producer rejecting
its own appended `@history` receipt on dependency refresh.

`EdgeWorker.pinned-inspection.test.ts` uses the actual native execution path and
real Git repositories. It covers single/multiple repositories, output correction,
serialized inspection checkpoints and provider-feedback changes. A result inspecting
A cannot acquire B's stamp, and stable A inputs still succeed. The original review
reproduction is retained separately with its observed wrong A/B result.

The old-shaped compatibility suite contains **one true restart case and five
conditional-input cases**. The latter validate production loading/input behavior;
they are not five additional restarts. No test-only registration enables legacy
compatibility in that suite.

## CI failures on the first revision head

Both complete jobs from run `39640902267` failed the package test step after a
successful frozen dependency install and build. Node 22 failed 54 cases, Node 24
failed 53; the same 53 failures occurred in both jobs. The additional Node 22
case assumed a valid expensive schema must take longer than the resource budget.
Validating within the budget is supported. The corrected assertion retains HTTP
responsiveness and an upper completion bound, accepts only exact valid results
or the specific resource-limit rejection, and keeps unknown-keyword rejection.
A real Ajv compilation with a fixed short VM budget separately tests interruption.

`TicketDelivery.test.ts` now supplies completed exact Factory publication/merge
receipts alongside its retained raw compatibility artifacts. All wrong-head,
external-drift, grouped approval, no-reimplementation and no-remerge assertions
remain. `EdgeWorker.merge-recovery.test.ts` loads real old accepted definitions
from disk through normal runtime loading. Its modern renamed case supplies only
qualified publication/frame evidence and protects an unrelated root output with
the same leaf ID. `FeedbackPolicy.test.ts` supplies actual executed CI ownership;
every grouped edit/order/fingerprint assertion is retained.

The exploratory Factory F1 caught a production call-frame regression: delivery
candidate recovery read the global output map, missed a valid local candidate
and looped through correction. Recovery now uses the active frame; a runtime
regression with a same-named root producer verifies the author is not replayed.
Merge recovery likewise writes the exact global/frame receipt. Self-result reads,
their derived delivery digest and tracking-outbox bookkeeping are excluded from
freshness comparisons, while changes to actual task inputs remain stale.

The bounded producer-collision audit also replaced leaf-name searches in impact
fanout configuration and passive worktree recovery with exact accepted graph keys.
Focused regressions cover distinct called fanouts with identical reviewer shapes,
unaccepted call paths, same-name passive/data roles, and guides whose historical
CI or handoff belongs to a sibling frame. Provider and managed credential selection
uses frozen repository identity; ordinary `repository` output remains ordinary data.
Only deterministically registered historical contexts retain old raw metadata or
partial specialist recovery adapters.
