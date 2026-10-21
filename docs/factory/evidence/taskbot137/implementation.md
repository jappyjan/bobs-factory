# Taskbot #137 implementation and acceptance evidence

> Independent round 1 requested changes R1–R3 on `2fbc21a3` (Taskbot comment
> 2082). The [point response and fresh validation](review-r1-fixes.md) supersede
> the final-source claims below for the recovery fixes. The original report
> remains intact as historical evidence; a new independent review is required.

Task: [bobs-factory #137](https://taskbot.apps.janjaap.de/p/bobs-factory/t/137),
epic [#135](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135). These are Taskbot
numbers, not GitHub issue numbers. Work is isolated in
`/Users/jappy/.t3/worktrees/bobs-factory/taskbot-137-check`, branch
`taskbot/137-generic-check`, based on freshly fetched
`95f79ef3be57bd8aa83d53b68c8130c28ef19dc9`. That main revision's Node 24 build/test,
lint and Website workflows were all successful before implementation.

The [complete before/after inventory](decision-tool-audit.md) was posted before
handler replacement as Taskbot comment **2070**, with byte-for-byte relay
confirmation. Integration decisions/failures are retained in comment **2071**.

| Criterion | Implementation / evidence |
| --- | --- |
| Generic no-agent/no-side-effect Check | Check.ts API + shared Rules.ts bounded generator; new Check/CheckIntegration/CheckSimulation tests |
| all/any/count/filter over nested result collections | Generic wildcard paths, strict missing/malformed collection failures, shared budget/output limits and yielding cancellation; no For each implementation |
| Decision-only stock tools removed | Factory/Takeover/called pipeline stock conversion to Check; acceptance/provenance inspection stay explicit actions; recursive graph assertions and actual F1 history |
| Ledger/nitpick/settled findings and unchanged assistance | Existing specialist/recovery suites plus StockCheckEquivalence and CheckReviewLifecycle; immutable exact-frame original receipt and declared review-assistance protocol |
| QA/media evidence authenticity/completeness | Fixed qa-gate-evidence reuses original checks; old/new equivalent outcome cases include incomplete reviewers, stale/missing/other-frame receipts and screenshot acceptance/hash failures |
| Fresh provider/action safeguards | Readiness inspection returns factual observations, Check makes configured decisions; CI, queued-fixer preflight, publication/handoff/merge/external/human actions preserve safeguards |
| Frozen definitions and resume | Normal-loading legacy integration test, actual historical saved-handoff fixture, #136 explicit gate compatibility and appended historical digests; original native record/map retained |
| Configuration and provenance, renamed/called frames | Named reads, declared fixed-check IDs, exact producer/fanout/frame receipts, renamed/nested tests and actual worker drive; ordinary role-shaped data cannot activate a protocol |
| Structured editor, errors and simulation | [UI report](check-ui.md); production endpoint/route parity, cancellation/error tests; desktop/390px light/dark editable Check screenshots |
| Documentation/capability reference | agent-step-configuration.md; workflowTriggerInstructions and entire expected routing prompt updated; role prompt bytes otherwise unchanged |
| Final gates / audit / F1 / binary | Final exact-source command receipts and report links are recorded below when complete; preliminary runs are never promoted to final passes |

## Consequential implementation decisions

- Shared rule work budgets remain fixed. Named Check evaluation touches selected
  data and rejects selected getters/prototypes/custom iterators/cycles. It does
  not eagerly walk an unrelated history or full specialist baseline.
- Original specialist evidence is runtime-owned immutable history. Pure Check
  results use small projections. Receipt consumers authenticate producer, lexical
  frame, declared fanout and unchanged original approval; ordinary copied outputs
  cannot impersonate a gate.
- Host native ticket timestamps become ISO only at the pure Check input boundary.
  Runtime scope/provenance still receives the original inputs, preserving #136
  effective-input digests. No arbitrary prototype/toJSON is admitted by the rule
  evaluator. Native and restored timestamp results match.
- Stock actions explicitly retain contract freezing and fresh provider inspection.
  A Check does not call a legacy decision tool or return a next-step identity.
- Declared `files-exist`, `media-valid`, `code-refs-valid` and `ids-resolve`
  selectors execute the existing fixed evidence library before predicates can
  pass. Check selectors share the bounded yielding traversal and cancellation
  rules. Unsupported agent/action protocols are rejected clearly at save/runtime;
  ordinary true predicates cannot silently bypass an accepted evidence guard.
  Simulation uses explicitly successful synthetic evidence and claims no live
  file or receipt verification.
- Existing completed-fixer native continuation behavior is preserved, including
  original records/session maps; no new continuation/progress-budget policy is
  introduced. #138–#148 and production rollout are outside this change.

## Existing test changes

- FactoryRenamedSteps adds the new explicit read-only evidence hook using the
  existing scripted FactoryTools command boundary. Every outcome, QA, approval,
  publication and merge assertion stays unchanged.
- WorkflowRuntime's saved nested handoff fixture now loads the real historical
  a4990127 graph rather than passing today's changing bundled default into a
  reserved workflow. Original action/history/continuation assertions stay unchanged.
- The capability prompt test is updated with the entire expected prompt. Check's
  new capability description is the only intended prompt text change.
- TicketDelivery's three modern flow fixtures bind the same read-only evidence
  hook as production. The action inventory now expects `accept-delivery` and no
  decision-tool invocation, and exact Check outputs/evidence dispatch are added.
  Three persisted-transition waits are bounded at 15 seconds after a diagnostic
  showed the old five-second wait expiring on the correct advancing external-apply
  step. Snapshot approval, no-Git, no repeated implementation/merge, relationship
  idempotency and architecture sequencing assertions remain intact.
- EdgeWorker.decision-documentation polls the durable JsonSnapshotStore directly
  instead of reconstructing the complete recipe catalog every 50ms. It still
  asserts normal WorkflowRuntime loading after completion and the same durable
  comment/native lifecycle. The original polling timed out with a running worker;
  the corrected test completes its behavior in 1.38 seconds with its original
  five-second deadline. No product scheduling change is introduced.
- SpecialistReview's synthetic branch-owned saved aggregate now declares its
  actual legacy inventory/fanout/gate producers in the modeled historical graph.
  The prior receipt named a step absent from that graph, correctly rejected by
  exact producer authority. These are unreachable completed historical roles,
  loaded normally from schema; this is not a claim that a newly authored nested
  question checkpoint passes today's fanout restrictions. Completed review/history
  counts and branch association assertions remain unchanged; no receipt
  authenticity or new-launch safeguard is relaxed.

## Preliminary failures retained

- Eager complete-input/aggregate projection exceeded the rule budget on stock
  specialist review. Fixed with charged selected traversal and a separate exact
  immutable runtime evidence receipt; no budget increase.
- Actual EdgeWorker found live host ticket Date objects differ from persisted ISO
  strings. Moving normalization into shared Check scope initially changed scope
  hashes and triggered valid stale-inventory/impact convergence protection. The
  field-level diagnostic matched the stored source digest exactly and proved the
  date-only difference; normalization now applies only to the pure rule document.
- Initial broad lint overlapped an in-progress helper edit and reported formatting;
  that run is not a final pass. Full package integration failures are investigated
  with assertions retained and are not reported as successful validation.
- The first broad package run was stopped after failures on an in-progress tree
  (exit 130), and is not final evidence. A sequential focused run passed the
  unchanged Architecture, UpdateMaintenance, FactoryReviewOutcome and
  ReviewSessionContinuity cases (55 tests); the separate documentation polling
  failure above was then corrected. FactoryPipeline passed all 51 tests unchanged.
- Actual-worker candidate 2 completed both repository scenarios, then correctly
  failed external completion: action hooks used the scripted target while
  background ticket tracking attempted an unconfigured native fixture transport.
  The driver now shares one exact-target scripted adapter across both independent
  production paths. Final-state and approval checks are unchanged; retained failed
  evidence is not relabeled as passing.


## Final validation and identity

Validated runtime commit: **ff5e2b20e035626c48bf0bd9ef5fa0ec00432572**.
The final required gates ran on a clean checkout; its source stayed unchanged
through all commands. The [small evidence index](validation-index.json) records
full commands, counts, exits, original log paths/SHA-256 and exact runtime trees.
Complete original logs remain at those paths; no histories are recopied.

| Final command / drive | Result |
| --- | --- |
| `pnpm build` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass; 34 existing warnings |
| `pnpm test:packages:run --maxWorkers=2` | 313 files; 3,935 passed, 2 existing skips; edge-worker 205 files / 2,611 passed / 1 skip |
| `pnpm --filter './apps/*' test:run` | CLI 254 + F1 17 + desktop 41 passed; 1 existing desktop skip |
| `node --test scripts/tests/*.test.mjs` | All 24 files; 179 passed |
| `pnpm audit` | Zero advisories; dependency graph unchanged |
| Native Bun 1.4.2 darwin-arm64 | Build, startup/restart, assets, protected API, scoped MCP and 5 compiled Check API cases passed |
| Actual EdgeWorker / CLI F1 | Stock repository, renamed/called repository and external delivery passed; zero paid calls |
| Final browser replay | Four viewport/theme visuals, structured editing/errors and pass/fail routes passed; unchanged original 17 screenshots reused |

The [F1 report](../../../../apps/f1/test-drives/2026-10-22-generic-check.md)
and [final UI equivalence receipt](check-ui-final.json) distinguish actual
execution from mocked provider/model behavior and reused visual evidence.
The compiled binary records commit `ff5e2b20`, `dirty:false`, target darwin-arm64,
SHA-256 `5360c188dc697c9d0425e194b49a62dcead28bcd793e77155574ea992ce15d5a`
and resource digest `cd8af2b5060c4de2bab1980d86ef872b3d7081df760b1b8bdae1fef172f0635c`.
Its original producer metadata remains unchanged; completed runtime smoke is a
separate receipt. This is one native target smoke, with no release publication.

The extra native API harness first omitted the exact Origin header (correctly
rejected with 403), then expected 400 for a runtime rule error whose existing
Factory contract returns 409. Correcting only those harness inputs/expectations
made all five cases pass on the same binary. Earlier logs remain indexed; no
production authentication/error rule or accepted assertion was weakened.

Subsequent commits contain only documentation, evidence and the actual PR link.
Their scoped diff and runtime/input tree identities are checked against the
validated commit; no additional build/F1 replay is needed for those unchanged
inputs. In particular, packages, CLI/F1/desktop runtime source, scripts, skills,
dependency inputs and both maintained Check drivers remain identical. Historical
reports, accepted run definitions, state and native conversations are preserved.

No implementation blocker remains. Independent acceptance review and green PR CI
are still required; ticket status, merge and later epic work belong to the parent.
