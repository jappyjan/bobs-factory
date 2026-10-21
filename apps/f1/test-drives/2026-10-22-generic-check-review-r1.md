# Generic Check — independent-review recovery regression drive

Taskbot bobs-factory #137 under epic #135; PR [#174](https://github.com/jappyjan/bobs-factory/pull/174).
Run date: 2026-10-22 Europe/Athens. UTC interval:
`2026-10-21T22:32:55.384Z`–`2026-10-21T22:35:32.440Z`. Result: **PASS**, exit 0.

Runtime source: `1ff4b5c40c1970ec6a7b9b7542ec1901bb3c5532`. Harness source: `783919c7baa062970134c35fd19cb0c64bae1c81`. Working-tree delta:
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Executed JavaScript SHA-256:
`4d38a7e7b34c7192c0b0df5c56f1b168dc6db795f8553becf09ab4705d441bea`. [Results index](assets/2026-10-22-generic-check-review-r1/results-index.json)
contains exact roles, checks/routes, frame/attempt/receipt identities, actions,
counts and retained raw locations/hashes. Fresh fixture: `/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-generic-check-OElZrI`.

```sh
F1_AGENT_MODE=mock F1_CHECK_RECOVERY=1 node apps/f1/test-drives/assets/generic-check.mjs
```

F1 applies to the changed assistance routing and native session lifecycle, and
to the functional driver extension. The driver executes built Node 24 JavaScript with the actual EdgeWorker,
CLI tracker/RPC, disposable Git worktrees, production result validation, Check
execution and action safeguards. All model/provider answers are deterministic;
paid calls: **0**. Attempt identities correctly report an unpackaged runtime; the driver source, clean input tree and executed-JavaScript digest provide source identity. Scripted forge merges are not remote merges. The two R1
scenarios deliberately use one additional runtime boundary each, as explained
below; all eight scenarios are not described as full SDK acceptance drives.

| Scenario | Boundary | Outcome | SDK turns / runtime-hook invocations | Check executions | Actions |
| --- | --- | --- | --- | --- | --- |
| stock-repository | EdgeWorker + mock SDK | completed | 19 / 0 | 3 | 9 |
| renamed-repository | EdgeWorker + mock SDK | completed | 19 / 0 | 3 | 9 |
| stock-external | EdgeWorker + mock SDK | completed | 3 / 0 | 2 | 7 |
| stock-specialist-assistance | Mixed: one controlled incomplete hook | completed | 20 / 1 | 4 | 10 |
| renamed-specialist-assistance | Mixed: one controlled incomplete hook | completed | 20 / 1 | 4 | 10 |
| ordinary-review-fields | EdgeWorker + mock SDK | completed | 1 / 0 | 1 | 0 |
| native-recovery-alternate | EdgeWorker + mock SDK | completed | 2 / 0 | 1 | 0 |
| native-recovery-inspect | EdgeWorker + mock SDK | completed | 2 / 0 | 2 | 0 |

Totals: 88 role invocations = 86 mock SDK
turns + 2 controlled runtime-hook invocations;
17 Check nodes, 20 Check executions,
45 actions, four publications and four guarded
scripted-provider merges. Every executed Check has `passed:boolean`, no agent
and no hidden `next`; runtime start events match the recipe's declared route.

## Original three EdgeWorker scenarios

Stock repository, every-step-renamed/called repository, and external delivery
retain all original assertions: serial role order, exactly six independent
specialists once per repository run, actual file/QA evidence, stale approval
rejection, explicit current acceptance, publication/final proof and guarded
provider-confirmed merge. External delivery preserves baseline relationships,
independent full-state readbacks, exact content/relationship writes and zero
Git/forge calls. CLI activity, pagination and durable comments remain asserted.
Their SDK boundary is unchanged from the historical three-scenario report.

## Two R1 mixed-boundary scenarios

The existing EdgeWorker guard rejects **any** blocked/failed required SDK
specialist before publishing its receipt. Two retained rejected attempts proved
that boundary, first with correctness then final coverage. Full logs/homes:
`/tmp/taskbot137-r1-final-f1.log` (`f1-generic-check-trztGX`) and
`/tmp/taskbot137-r1-final-f1-v2.log` (`f1-generic-check-XaqRHU`). Both passed the
original three scenarios; neither is an incomplete-recovery pass. An initial
prerequisite diagnosis was superseded after tracing the guard. No SDK guard,
receipt, policy budget, approval or security assertion changed.

The final stock and fully renamed/called R1 scenarios return one controlled
blocked coverage result through `RuntimeHooks.agent` **before** invoking the
EdgeWorker hook, matching the generic boundary used by the retained legacy
runtime test. Runtime result validation, exact revision/fanout/frame stamping,
original evidence sidecars, Check projection and assistance routing remain
production code. The controlled turn/attempt/receipt is recorded separately
and has no native ID. It is not a fresh SDK-accepted specialist and does not
claim native conversation continuity. All other roles, including the fresh
coverage review after assistance, execute through EdgeWorker with the mock SDK.

The repaired runtime also keeps accepted impact output separate from mutable
operational progress and reconstructs retained snapshots from the authenticated
exact-round sidecar. The original binding/accepted assessment bytes must remain
unchanged through recovery. The source and authority diagnosis, red/green tests
and disjoint seam check are in the [review response](../../../docs/factory/evidence/taskbot137/review-r1-fixes.md).

Both require reassessment before outstanding coverage, one inventory and one
implementation, zero fixer calls, exactly two impact assessments, five completed
specialists each run once, exact original receipt digests retained/reused in the
same inventory, and two coverage invocations (controlled incomplete then SDK
complete). Approval cannot occur before assistance; final human acceptance and
merge retain ordinary guards. This boundary was authorized in Taskbot comment
2087. A new independent reviewer must assess its adequacy together with the
retained-result/restart tests; this mixed scenario alone is not clearance.

## Retained safe-JSON fixture failure

The first unfiltered final run on runtime source `1ff4b5c4` passed the original
three, both R1 and ordinary R2 scenarios, then stopped at an expected prototype
mismatch in the alternate-agent fixture: production returned the correct safe
null-prototype object with exactly `completed:true`; the test expected a normal
object. `/tmp/taskbot137-r1-retention-final-f1.log` and home
`f1-generic-check-bgXlA1` remain intact. It is not a final pass. The harness now
asserts the exact null-prototype object, preserving complete payload, native
identity, resume and visit assertions and the production safe-JSON guard. Both
native scenarios pass individually before the fresh unfiltered final8. This
harness-only correction preserves all validated runtime/native inputs.
The first focused alternate then exposed a route-audit expectation of a generic
Finished event. The explicit assistance path instead records an ended blocked
Check attempt and saved human answer before routing. The fixture verifies that
attempt/type/outcome and receipt/end/answer ordering, exact stored answer and
declared next start, while preserving the generic finish-event assertion for
ordinary paths. Its failed home `f1-generic-check-cCPNJB` and
`/tmp/taskbot137-r1-safe-json-alternate.log` remain visible. Payload, session and
visit assertions remain intact; both focused native scenarios pass afterward.

## Other new EdgeWorker scenarios

The ordinary result scenario declares only read-only review evidence, returns
named `reviewBlocked` and `questions` with `passed:false`, and reaches its
ordinary terminal route without waiting or a hidden fixer. Focused tests also
cover `passed:true`, `reviewIncomplete`, and no evidence declaration.

Nested native-destination scenarios retain the original mock reviewer ID and
visits. Returning to that reviewer requests its own continuation and increments
its visits; routing to a fresh alternate requests no reviewer continuation and
leaves reviewer visits unchanged. Saved original native identity remains intact.
Eight focused direct/called tests additionally cover an alternate's own saved
session, exact legacy native-event fallback, restart while waiting and restart
after destination/session/visits are durably saved. Those restarts are focused
production-runtime evidence, not a restarted EdgeWorker process.

All owned sessions/servers stop in `finally`. Original reports, screenshots and
all failed attempts are retained. Full runtime gates and native smoke use clean source `1ff4b5c40c1970ec6a7b9b7542ec1901bb3c5532`. The final driver
source is `783919c7baa062970134c35fd19cb0c64bae1c81`; only its exact-null-prototype assertion, answered-checkpoint route audit and diagnostic
selection differ. Fresh syntax/lint and both native scenarios pass, followed by
this unfiltered eight-scenario run. Nine runtime/build/test/dependency trees and
executed JavaScript are unchanged. Earlier `52fb8fd3` passes are historical after
the retention repair; no changed runtime is justified by those passes. Evidence-only
commits afterward do not change runtime, test, build or driver inputs. Takeover's graph is inspected but not run
as a delivery drive. No paid/live model, external authentication, production
configuration, active run, deployment or release was changed.
