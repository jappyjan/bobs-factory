# Taskbot #138 implementation and acceptance map

[Ticket](https://taskbot.apps.janjaap.de/p/bobs-factory/t/138) ·
[Epic](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135).
Implementation-owned checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-138-foreach`,
branch `taskbot/138-foreach`. Parent checkout and retained #136/#137/reviewer
worktrees were not edited. T3 thread binding remains inherited; all repository
operations explicitly target this isolated checkout.

Base: freshly fetched `fdf52677be7ef22f8e31001031a26da61f4efdb3`.
Exact-main CI39689410541 Build/test Node24 and Lint were success before work;
Website was path-filtered and is not claimed current-SHA green.
Source uses Node24.21.0 / pinned pnpm10.33.1. The local binary embeds Bun1.4.2;
no Node22 support, shim or migration was added. No dependencies changed.

Production freeze: `9b79a19f7b672a8a759400cc9f715aec3f140635`, tree
`6a2381c20aee641f7af2578a2ccbf3cab4a3434b`, web `37aae3292ed089cb18e738f1`.
`31c3c6330159844c098a52716882d415668edf05` changes only the UI fixture readiness
wait; `f4fe779d` changes only the existing fixture teardown. Subsequent evidence/changelog commits must be assessed through the exact
unchanged-input bridge in the validation index, not relabeled as this build.

## Decisions and boundaries

The pre-implementation fanout/call/checkpoint/capacity audit and decisions were
recorded on #138 as comment2110. Full syntax and operational semantics are in
[For each recipes](../../foreach.md).

- `items.from` safe JSON Pointer or `items.values` inline list; `body` is an inline
  graph, with an ordinary mapped Call as its one-step alternative. Default ID
  pointer `/id`; empty pointer explicitly supports string lists. Unique safe string
  IDs 1–80 chars; malformed/missing/numeric/duplicate/prototype IDs reject.
- Default concurrency4 (1–32), maxItems100 (1–1000), all-must-succeed. Entire
  bounded plain JSON source is accepted before dispatch. Overflow fails rather
  than truncating. Item values/order/IDs/settings/body/input outputs stay frozen.
- `/item` and `/index` are lexical; `@item`/`@index` named reads and explicit
  `inputMapping`/`@callInputs` preserve ownership through Call, Parallel and nested
  For each. Child graph output mutation cannot alter accepted mappings or parents.
- Full frame keys and original item digests accompany history/attempt provenance.
  Accepted snapshot/history is distinct from mutable operational item progress.
- all-must-succeed aborts active siblings, stops pending work and waits for cleanup;
  keep-successful retains successes with every explicit failure/limitation. Outer
  stop/update/shutdown never becomes successful partial aggregation.
- Per-item ordinary visits/native contexts persist. Completed leaves stay skipped;
  unfinished logical work may continue in another native turn. Explicit Retry
  preserves the failed destination conversation and completed siblings. No arbitrary
  exactly-once effect promise or future generic convergence policy is introduced.
- Only actual intensive/agent leaves hold MachineCapacity/resource admission.
  Orchestration retains no blocking parent slot. Human steps reject transitively,
  and existing recursive-call/depth safeguards remain.

## Criterion map

| Requirement / risk | Consequential verification |
| --- | --- |
| Agent-output sample → iteration → Check, arbitrary IDs and named reads | `ForeachRuntime.test.ts` source→For each→Check; six-scenario mocked EdgeWorker/CLI [F1](../../../../apps/f1/test-drives/2026-10-22-generic-foreach.md) |
| Configured concurrency and real machine capacity, nested deadlock avoidance | Runtime dispatch bound/accepted-order case and real MachineCapacity1 nested Call intensive-leaf case; F1 actual pool2; compiled product pool2 |
| Both failure policies, active-sibling abort and truthful partial state | Runtime active-sibling/undispatched case, terminal failed/blocked called/Parallel outputs, cancellation; F1/native both policies |
| Mid-iteration restart, settled items skipped, retained native session | Ordinary disk loading after shutdown, duplicate resumeAll, original completed history exactly once; completion-before-join save barrier; failed native destination + explicit Retry; per-item visit persistence |
| Inline lists, malformed paths/limits/keys and safe objects | `Foreach.test.ts`33 cases: source/accessors/prototypes/sparse/oversized/missing/non-array/duplicates; runtime frozen source across catalog/output changes |
| Nested/called lexical item/index and mapping isolation | Runtime full nested outputs + caller mapping mutation regression; F1 and native nested Call results and Checks |
| Human restrictions, recursion/depth, provider preflight | Schema/catalog transitive human/cycle/depth cases; `ForeachPreflight.test.ts` scans inline/nested/called/title providers once |
| Output shapes, named consumption and provenance | Complete runtime/F1 keyed output assertions, full item/frame digests in history; immutable accepted sources separate from progress |
| Builder container, source/body/concurrency editing and malformed Save rejection | `FactoryForeachEditor.test.ts`; actual browser interactions + [18 screenshots](ui.md) |
| Simulation per-item policy/limits and run activity | Shared production prepare/aggregate with explicit synthetic outcomes; editor tests and actual browser Pass/Fail/Visit limit; actual persisted run statuses |
| Capability reference and compatibility | `workflowTriggerInstructions` updated; entire prompt-assembly expected string updated, not partial contains; existing behavior/security assertions retained |
| Compiled runtime behavior | [Full-product smoke](native.md): shell source→Call/nested For each→Checks, both policies, settled startup/restart with Node/Bun absent from PATH |
| Required combined local gates | Exact commands/exits/counts/timestamps/source/log hashes in validation index |

Test paths are under `packages/edge-worker/test/`. Focused final integration:
81/81 in six files, including the existing recipe-graph/Check-editor cases.

## Existing fixture changes and preliminary outcomes

No existing behavioral/security assertion was removed or weakened. Existing test edits are the entire expected routing-context capability prompt,
adding the documented For each/mapped Call capability, and lifecycle-only cleanup
in the ticket-launch fixture. That fixture reloads factoryRuntime while retaining
only the original runtime in teardown, and did not stop storage-retention workers.
Its first full attempt failed with ENOTEMPTY during rmSync(home), after all ownership
assertions passed. Captured/current retention owners are now stopped and both runtime
owners drained before deletion; every assertion is unchanged. The exact existing
59-case file passed after the fix. All new tests protect new runtime/editor boundaries. Internal seam review is implementation work, not
independent acceptance: it found descriptor-before-Zod validation, terminal failure
propagation through Call/Parallel, native Retry continuity, mutable call-input alias
and provider preflight traversal gaps, all fixed before production freeze.

Failed/preliminary runs remain separate from final passes in the log index.
Initial helper fixtures had Zod wording/parameter unpacking/save-barrier cleanup
mistakes; a combined focused attempt lacked built dashboard current.json assets.
A sparse-array wording assertion was adjusted after descriptor-first validation.
The UI driver needed to wait for dispatched hooks to enter; the native harness
omitted required fixture workspace metadata and was rejected before readiness.
No accepted state or guard was patched to obtain the final results.

## Limits and handoff

Restart coverage uses graceful shutdown/normal serialized loading and a controlled
save barrier. It does not simulate OS process kill at every instruction. The F1
EdgeWorker is not restarted; compiled native restart is after terminal settlement.
The dedicated runtime suite establishes mid-iteration native checkpoint continuity.
Mocked providers establish orchestration, not model quality or paid CLI behavior.
Browser simulation outcomes are synthetic and clearly labeled. The browser fixture
uses real runtime progress with scripted hooks, not an actual model or patched run.

No deployment, release publication, active production run change, credential-store
migration, #139–#148 implementation, Improve rewrite or generic replay/progress
policy was performed. Parent owns fresh independent acceptance, exact-head CI
watch, requested review fixes and squash merge. Checkout remains retained for fixes.

Generated JSON receipts have readable repository-formatted copies; [original byte receipts](raw-json.json) retain their exact original JSON in gzip form. Recorded original hashes refer to the decompressed raw copies. PNG and driver bytes are unchanged.

## Final local gates

All commands exited0. Build passed on clean production9b79 (9.811s). After the two
fixture-only changes, cleanf4fe passed root typecheck4.343s, lint1.454s, complete
packages619.312s (**4,013 passed, two skipped** across16 workspaces), apps58.912s
(**312 passed, one skipped**), all24 script files65.606s (**179 passed**) and audit1.226s
(**zero advisories**). Root lint retains34 existing warnings and zero errors.
The final sequential gates ran UTC2026-10-21T23:49:21.338 through the exact finish
time in gates-final.json on2026-10-22. Both fixture changes leave every production
source/build input unchanged; every UI source/backend hash, F1 driver/built-JS
digest and binary/driver hash was rechecked after the full suites and matched.
The required build is reused with that explicit input proof; no new build identity
is invented for the fixture/evidence head.

Fresh fetch finished at2026-10-22T00:00:29Z and confirmed origin/main remains
fdf52677. The initial exact-main required green checks therefore still identify
this same base. No child CI watching/retries or merge was performed.
