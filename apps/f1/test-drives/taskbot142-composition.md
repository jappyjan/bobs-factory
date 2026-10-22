# Taskbot #142: static Factory composition

Date: 2026-10-23. Implementation verification, not independent acceptance.
PR: [#179](https://github.com/jappyjan/bobs-factory/pull/179). Implementation source commit: `40b07f0683a7d5cf256e7f1b8d3b5040f7d72b64`, tree `59062ae245d8c08aee0697eb7de51cae8218d180`. The following documentation-only commit adds the PR link and lifecycle receipt; all 41 recorded source/harness inputs remain identical.
Base: `578bb28233fe699b6743bf84cb24895b25da3ed0` (fresh fetch unchanged before publication).
Checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-142-composition`, branch `taskbot/142-composition`.
Node 24.21.0 / pnpm 10.33.1. Actual app preview used existing Bun 1.4.2; no native build or inference.

The live pre-replacement AUDIT/DECISION is Taskbot #142 comment 2405. The installed #141 baseline is qualified by #141 comments 2395, 2397 and 2398. [Input hashes](media/taskbot142-composition/inputs.json) and [compact raw-log/flow receipts](media/taskbot142-composition/receipts.json) identify the tested source and retained local bytes.

## Mechanism and equivalence

Factory now has ten real Calls. Takeover inspects and assesses its existing PR, then uses those same Calls. `defaultWorkflows.ts` validates static definitions; it does not splice delivery, insert impact, patch videos/guides or rewrite screenshot roles. The 41 configured baseline roles and 76 prompt/instruction strings were copied exactly. All 210 stock base/runtime/native prompt variants match after translating their actual recipe paths; all 429 frozen/common variants remain unchanged. Complete prompt, component and prompt-type assertions remain enabled.

A recipe declares `inputs` and terminal `outcomes`. A Call binds input names to actual accepted producer paths, including forwarded `@bindings/name` ports. Normal branches match the returned `outcome` and may specify an explicit child `entry`. Validation rejects missing producers, undeclared outcomes and invalid entries. Returned JSON is produced-only; matching inherited JSON cannot create action, Snapshot or approval authority. Containers retain their original receipt ownership.

An outcome-enabled Call retains its exact child checkpoint across correction routes and restart: outputs, native identities, original visits and unchanged-cycle limits. The active restored child is registered before dispatch. Caller routes do not replay prior clarification or publication. Architecture acceptance refreshes the configured original plan location. The external-guide action owns its own result slot rather than impersonating the repository-guide agent. Imported independent correction obligations follow the configured assessor and actual next fixer, so passing provider CI cannot erase them.

Explicit external recovery/reverification finds the action through the accepted sequential Call closure and re-enters its retained frame. Frozen pre-142 recovery keeps the former static destination. The other bounded compatibility adapters are unchanged historical prompt/graph upgrades, exact old stock recognition and relocation of old stock execution preferences to their actual new role owners. Accepted runs and copied local/fork closures are not upgraded. Legacy ordinary plan-only contexts retain their original input shape.

| Original obligation | Composition / evidence |
| --- | --- |
| Clarify, record decisions, plan and independent rejection loop | Clarify & plan; repository drive rejects first plan review; clarification executes once |
| Repository / external / mixed / deferred routing | Route by delivery keeps original Check rules and deferred human question; three delivery modes driven below |
| Meaningful architecture approval / routine bypass | Check in with you; exact-version stale rejection and native acceptance in repository; mixed uses routine bypass |
| Implement and push/draft existing or new PR | Implement; real isolated Git commits/pushes to local bare remotes; mocked forge receipts, Takeover retains original PR |
| Independent impact, parallel specialists, fixes and unchanged-cycle limits | Review loop; failed specialist review, resolved original finding, preserved correction obligations and retained-frame limit test |
| QA, screenshots/video and visual correction | QA & screenshots retains complete configured roles; actual nonvisual CLI QA in drives, existing media/visual tests retained |
| Watch CI, CI fix, after-fix review and passive waits | CI watch & fix retains product readiness rules; mocked fresh provider checks; repository handoff returns to CI fix |
| Guide, verify handoff, human review and human fixes | Review guide & your approval; real native decision APIs with exact server gate/head/digest; stale submissions rejected |
| Merge rework and actual provider confirmation | Merge returns to original review/CI routes; mocked executed provider merge allowed only after fresh human/provider prerequisites |
| Apply, verify, guide, external human/correction, final check and reverify | External ticket delivery; real TicketDelivery against in-memory tracker, mixed correction renews plan version, waiting restart and fresh explicit reverification |
| Frozen definitions, forks and renamed/nested sources | Genuine #141 definition control; historical fixture equals all nine baseline definitions; nested Snapshot ports and original receipt tests; actual UI private fork |

## Controlled production-runtime drives

F1 applies to the runtime, Call routing and canvas changes. `FactoryComposition.test.ts` drives actual `WorkflowRuntime`, `FactoryTools`, `TicketDelivery` and EdgeWorker's actual output finalizer. The EdgeWorker host boundary is constructed with controlled dependencies; this is not a full native-agent session. Each repository drive creates a real isolated Git repo and bare origin, performs real local commits/pushes and executes an actual Node CLI QA check. Tracker, forge, CI and model responses are synthetic, with no live tracker/forge/CI or inference effects. Exact human decisions go through production APIs; approved flags are not injected as evidence.

| Named flow | Result | Consequential paths |
| --- | --- | --- |
| Factory repository | Completed; 63 history receipts | Plan rejection, meaningful architecture, impact-required CI fix, independent failed review, handoff → CI fix, merge rework → review, renewed approval |
| Factory external ticket | Completed; 23 receipts | Durable apply/verify; waiting shutdown/reload with original history; stale rejection; explicit post-completion reverify retains verifier pass count 2 and requires a fresh human decision |
| Factory mixed | Completed; 94 receipts | External plus repository obligations; rejected review → external correction → plan v2; original clarification stays at pass 1; final ticket and confirmed repository state required |
| Takeover | Completed; 65 receipts | Inspect existing PR and assessment; same shared blocks and correction routes; original URL/branch retained |
| Frozen #141 Factory external control | Completed; 14 receipts | Original flat accepted definition and paths, independent verifier and native human gate preserved |

Commands (from this checkout):

- `pnpm --filter bobs-factory-edge-worker exec vitest run test/FactoryComposition.test.ts test/WorkflowRuntime.test.ts -t 'drives actual production composition|permits deliberate|upgrades a saved flat'`: four flow cases and two selected runtime cases passed; the added external reverify harness request omitted its exact head and was correctly rejected.
- After adding that missing request field only, `pnpm --filter bobs-factory-edge-worker exec vitest run test/FactoryComposition.test.ts -t 'external / takeover=false frozen=false'`: **1 passed / 4 skipped**. The four prior passing cases are reused: production inputs are identical, and their paths do not execute the edited external-only request. This is not a claim of a fresh five-pass command.
- Final focused contracts: `CallOutcomes`, `SnapshotCallMapping`, `ParallelCallOwnership`, `FactoryRecipeGraph`, `WorkflowCatalog`, `FactoryRolePrompts`, `prompt-assembly.routing-context`: **7 files / 60 tests passed**.
- Owning Node and web `tsgo --noEmit` checks passed. Scoped Biome and web asset build passed. Final web build `879d38a4edaef916c2d90af7` exactly matches the captured app build.
- Additional focused historical delivery/recovery, architecture, media, storage, preference and presentation tests were run. Earlier probes and failed attempts remain local with hashes/counts in the receipts. The 139-case runtime-file probe had 126 passes and 13 failures; those affected cases were corrected and passed in targeted runs. No fresh full-suite pass is claimed.

## Canvas and accepted configuration

Actual protected `FactoryServer` and its built immutable app were used through T3 preview, in a fresh isolated factory home. No HTML/CSS injection or proxy relaxation. Stock Factory and a private fork created through Settings → Fork show actual called recipes. The fork has ten private child definitions; [configuration receipt](media/taskbot142-composition/ui.json) includes their real IDs and bindings. T3 remains bound to the coordinator checkout; this manual worktree did not rebind the thread.

| View | Light | Dark |
| --- | --- | --- |
| Desktop 1440×900 collapsed | [capture](media/taskbot142-composition/desktop-light-collapsed.png) | [capture](media/taskbot142-composition/desktop-dark-collapsed.png) |
| Desktop expanded | [capture](media/taskbot142-composition/desktop-light-expanded.png) | [capture](media/taskbot142-composition/desktop-dark-expanded.png) |
| 390×844 collapsed | [capture](media/taskbot142-composition/390-light-collapsed.png) | [capture](media/taskbot142-composition/390-dark-collapsed.png) |
| 390×844 expanded | [capture](media/taskbot142-composition/390-light-expanded.png) | [capture](media/taskbot142-composition/390-dark-expanded.png) |

At 360×800, document scroll width equals viewport width (360), Call controls measure 192×44 CSS pixels, and Enter toggles the focused Expand/Collapse button without selecting the parent. The actual fork also expands its private child and stays within the document width: [collapsed](media/taskbot142-composition/fork-360-collapsed.png), [expanded](media/taskbot142-composition/fork-360-expanded.png). The canvas can pan/zoom; expansion exposes child routes and explicit outcome terminals rather than flattening execution.

## Fixture changes and limits

Role-specific old tests now import `fixtures/pre-composition.ts`, whose reconstructed definitions equal the genuine baseline. Media, storage, delivery, merge-recovery and operational-presentation fixtures explicitly restore those historical accepted definitions before adding their original test receipts; new admission correctly resolves reserved IDs to the current catalog. The legacy-review helper retains its old private graph but supplies current bundled definitions when saving new local fixtures. Catalog/architecture/runtime assertions point to the actual new role owner, permit standalone calls and preserve genuine internal-permission tests using a private fixture. Security/outcome assertions remain intact; no existing timeout or approval requirement was relaxed. The new controlled-drive wait allowance accounts for its actual multi-role disk/Git work.

Manual broad monorepo build/type/lint/packages/apps/scripts/audit/native cycles and development CI are deferred by the current epic policy. No release, deployment, live CI, real tracker/forge mutations or native credential/history changes occurred. Product CI watch, independent evidence, human approval and provider delivery checks remain active in the mocked flows. Native inference and physical-device behavior are not claimed. Independent Standards/Spec acceptance and merge belong to the parent coordinator.

Lifecycle: both delegated helpers completed without pending turns before freeze. All controlled runtime drives shut down and removed their synthetic workspaces; the actual preview tab was closed and the preview server exited (port 36142 has no listener). Normal Git commit ran with the configured hook path; this checkout had no pre-commit shim, so hook build/type gates did not run. No manual broad gate is claimed. The checkout is retained for independent review; no ticket status or merge action was performed.
