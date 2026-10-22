# Independent acceptance round1 — NOT CLEAN

PR177: https://github.com/jappyjan/bobs-factory/pull/177. Six consequential findings remain at this immutable target; passing tests and disclosed limitations do not waive them. No revised-source clearance is given.

## Target, independence and policy

- Reviewed HEAD `246e422d2110ae743acb6ed561d549db0784703f`, tree `0fa0f6d082f17e859be8ab458c2601b7f7d2b264`, fixed merge-base/base/main `fa866b3d18a880a72fb59f19bfc88195cd4db762`. Pickup and final remote PR/main reads matched. Diff: `git diff fa866b3d18a880a72fb59f19bfc88195cd4db762...HEAD`; commits318c93ff,e4e9fe2c,667cbffd,2e090de9,246e422d.
- Fresh retained own checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-140-review-r1`, detached HEAD, final `git status --short` empty and `git diff --exit-code HEAD` exit0. Inherited T3 app binding remains coordinator checkout; this manual worktree did not rebind it. Implementation/coordinator/previous worktrees were not used for builds, probes or source writes.
- Read live140/135 in full, decision/progress timelines and attachment metadata219/220. Read applicable root AGENTS/CLAUDE, packages/CLAUDE, apps/f1/CLAUDE, CONTRIBUTING, PRODUCT_CONTRACTS, distribution guidance and canonical verification/F1 policy. Applied code-review skill with distinct parallel read-only Standards and Spec helpers; I integrated their source proofs and independently executed probes. Missing optional docs/agents/issue-tracker.md is a setup-document omission, not a blocker because the user supplied the live Taskbot authority/tools.
- No source fixes, pushes, PR reviews/approval, status changes, CI watching/retries, merges, deployments, releases, active production-run edits or141+ work. PR177 registered and final link inventories verified on child and parent; child watching=false, parent watch untouched.

## Standards

**FAIL — R2/P1.** The documented context-only Ask boundary is not enforced by the actual runner. ViewRuntime.ts:634 sets workspace access plus an allow-list. EdgeWorker.ts:9240 restricts only read-only research;9530–9558 workspace processing retains native powers and adds result-artifact submission. Native Codex creation at11300–11305 defaults to danger-full-access with only multi_agent disabled. This violates the declared list/read-only boundary in docs/factory/views.md and the task's no-mutation requirement; repository harness guidance requires checking actual provider permission semantics.

Independent production EdgeWorker/CLI configuration capture confirms the allow-list includes submit_result_artifact, additional writable evidence access, no native tool removal, and unrelated cyrus-docs MCP. Production CodexConfigBuilder resolves the captured config to danger-full-access/networkAccess:true/approvalPolicy:never without disabling shell_tool/apply_patch_tool. Expected correction: enforced provider-specific context-only profile without a Snapshot prerequisite, preserving native Ask identity.

No additional consequential naming, ownership, dependency-security, scope or test-weakening violation found. No smell-only finding warrants action. Only the full capability-prompt expectation changed among pre-existing tests; original stock prompts, assertions and timeouts are retained.

## Spec

**FAIL — R2–R6.** Schema/library/generic step composition largely works, but Ask isolation, asynchronous current-batch ownership, text channels, builder provenance and component-text push delivery do not satisfy the complete contract. The following findings are authoritative and remain open against246:

| ID | Priority | Concrete trigger, observed versus required, and narrow correction |
| --- | --- | --- |
| R1 | P2 | Open published raw gate/native/UI log links or verify archive-sha256.json from a fresh checkout. The report's full-package link (apps/f1/test-drives/2026-10-22-taskbot140-views.md:123–126) and archive enumerate files absent from Git. All58 gates/logs entries and13 additional native/UI logs are missing:71/186 advertised archive entries. Preserve exact original bytes and correct fresh-checkout links/manifests; unchanged gates need not be rerun. Detailed ticket2182. |
| R2 | P1 | Inline Ask on Codex can retain native shell/patch and unrelated tool powers despite list/read-only claims. Exact source and actual runner/config reproduction above; detailed2183 and2195. Enforce a dedicated context-only provider profile and test the actual resolved config, not only RuntimeHooks.agent's request. |
| R3 | P2 | After dashboard Ask, terminal/API text carries the new digest but omits its question/answer. ViewRuntime.ts:402–438 never traverses threads. Also13 valid8000-character item bodies cause the final100000-character slice to remove batch/digest/answer command without notice; two preceding Shows can consume displayText's entire prefix at440–449. Actual production-runtime probes reproduced all three. Include bounded discussion/status, prioritize current pending decision, reserve its exact protocol and make truncation/complete-display requirements explicit. Detailed2185. |
| R4 | P1 | Actual Launch(wait:false)→Decide: hold Ask, finish real launched child, submit stale content to rotate batch, finish old Ask. ViewRuntime.ts:666–668 republishes superseded snapshot after487–505 rotated it. Published ID becomes original660f3ff4… while frame.active.viewId stays renewed1f3a4d4b…. New answer rejects 'Run is not waiting'; old rejects 'superseded'. Neither is accepted. No receipt/checkpoint patching. Late results must retain historical ownership without replacing inactive/current/terminal displays; verify persistence/restart. Detailed2187. |
| R5 | P2 | Load a matching Last run, then edit view or Decide actions/Ask configuration. human-step-settings.tsx:241–253 invalidates only step/read changes;262–285 previews current config while324–327 retains the earlier server definitionMatch=true label. A pending response can install the obsolete match too. Bind provenance to exact requested/current configuration and show mismatch/invalidate after edits. Exact source proof; detailed2190. |
| R6 | P2 acceptance gap | PushEvents.ts:40–51 carries category/identity/destination; FactoryPush.ts:429–437 always serializes fixed category text. No component fallback is delivered, contrary to140 Fallbacks. docs/FACTORY.md:431–435 requires private fixed text, so this is an explicit contract discrepancy, not missing attention alerts. Preserve private defaults and reconcile via trusted explicit opt-in bounded view text plus serialized-payload/privacy/dedup tests. Parent has accepted that future repair direction; it does not clear246. Detailed2191. |

## Every140 scope/acceptance row

| Requirement | Disposition at246 and evidence |
| --- | --- |
| Schema-defined list, literal/JSON-pointer binding, save and render validation | PASS in reviewed source and independently rerun contract/API suites. Strict view-v1, bounded plain descriptors/dense JSON, safe lexical /inputs,/item,/index; invalid shapes/unknown components/unsafe pointers rejected. |
| Agent-authored library view | PASS structural/data behavior: OutputFormats→ViewSchema and actual retained F1 emitted view-v1 including empty screenshots. Agent labels/actions do not grant native approval. Ask's separate execution authority fails R2. |
| markdown | Renderer and useful escaped text fallback present; malicious HTML/links/images inert in focused tests and retained browser evidence. |
| checklist | Renderer/state/detail plus textual checked/partial/open cases present. |
| before/after | Labelled paired renderer and text sections present. |
| chart | Bar/line numeric rendering, labelled values and series text present. |
| screenshots | Protected current-run images/alt/caption/hash fallback; empty selection needs no producer. Five independently rerun real-file tests cover size-before-read, mutation, hashes/index and foreign paths. No new confirmed media finding. |
| video | Protected same-run verified inventory/revision/hash plus visible transcript and textual hash/transcript. Source reviewed; existing native video endpoint retained. No live video/OS accessibility claim. |
| table | Bounded native table with headers/scalar text fallback. |
| code reference | Bounded repository-relative reference, ordered lines and inert excerpt; no arbitrary file fetch/execution. |
| steps | Ordered status/detail renderer and numbered text. |
| points | Label/detail, validated click-only HTTP(S) links, useful text. |
| item cards/actions/comments/details/inline Ask | Real recipe-owned controls and output mapping work; optional per-action comments/details present. Dedicated persisted Ask identity/model inheritance works in ordinary case. FAIL R2 execution restrictions, R3 text discussion and R4 stale-result ownership. |
| choices/form | Labelled controls, configured options, required values and exact accepted fields tested. |
| run list | Public Launch waves/statuses and child navigation present. Actual child completion drives R4 repro, without inventing merge proof. |
| sticky decision bar | Real explicit controls, confirmation and mobile layout present; agent-rendered action labels inert. |
| Decide outputs and ordinary branches | PASS choices/itemsByAction/followUps/hasFollowUps via independent18-test runtime coverage and authenticated actual F1 choices/alternate-route receipts. |
| Approve/Request changes/exact digest | PASS explicit accepted:true, feedback, server batch/config/items/view, asset and thread digest checks in ordinary/stale/concurrent tests. Native architecture/delivery/merge authority stays separate. FAIL shared async ownership R4; other displayed-content security probes passed. |
| Show nonblocking | PASS normal and concurrent For each/Call behavior; no human wait, long-lived execution/capacity reservation or decision push. Existing transitive concurrent-blocking-human prohibition retained. Sequential Calls and post-loop outputs remain usable; prohibition is compatible with foundational single-human ownership and is not early143 work. Text-history prioritization fails R3. |
| Dashboard/API answers | PASS ordinary explicit validator, stale rejection, required fields, exact-idempotent retries/conflicts and persisted reconstruction; R4 pathological pending-Ask rotation remains. |
| Terminal answers | Explicit digest-bearing /view-answer protocol works at ordinary sizes; FAIL R3 for missing discussion/protocol/current display. |
| Ticket replies/comments | Native incoming Factory reply path uses explicit protocol; free text cannot auto-approve. Linear/CLI/F1 path covered by source/retained F1. Taskbot has no inbound ingestion: 'where applicable' does not require adding one in140; outbound Taskbot component fallback still required and present subject to R3. |
| Push new-decision notification | Batch/digest identity and persisted dedup exist, Show excluded. At-most-one-attempt/no-replay semantics match maintained policy. Component-text delivery FAIL R6; no live device-delivery claim. |
| Restart-safe waits/history | Ordinary saved-batch, exact accepted answer/retry/conflict, native Ask-session restoration pass independently rerun tests and retained reconstructions. R4 stale late result remains a real current-batch failure. |
| Text fallbacks for all14 | All14 component functions are useful, not placeholder JSON. Aggregate terminal/ticket discussion/bounds FAIL R3; actual push fallback FAIL R6. |
| Builder JSON/schema errors and Save refusal | PASS source,6 independently rerun integration tests and retained actual invalid/valid Save interaction. |
| Available-path autocomplete/insertion | PASS bounded supplied scope/path discovery plus retained actual insertion receipt. |
| Sample/last-run live preview | Sample and safe retained input snapshot present; no private run wandering. FAIL exact post-edit match provenance R5. |
| 360px no horizontal scrolling | Authenticated six settled theme/page audits show body/document360 and no overflows. Reviewed all12 actual PNGs, not hashes alone. No new layout finding. |
| Light/dark and required screenshots | PASS all12 desktop/390×light/dark Decide/Approve/run-list images; all bytes match original T3 screenshot artifacts and PR body has12 image links. |
| Keyboard/screen-reader meaningful structure | Semantic groups/labels/radios/fields/tables/statuses and visible keyboard controls reviewed; retained real Arrow/Tab/focus/Ask-confirmation receipts authenticate. No actual OS screen-reader session claimed or required for this evidence assessment. |
| Component tests, malicious-input tests | PASS independently116 tests in7 relevant files; all14/fallback/malicious strings/schema/API/assets covered, but existing tests miss R2–R6 triggers. |
| Decide/Approve E2E routes/stale/restart | Relevant authenticated3-scenario actual EdgeWorker/CLI mocked F1 plus independent runtime coverage; remaining R2/R4 prevent complete acceptance. |
| Full suite passes | Authenticated original final complete4257packages/335files/16packages,313apps,179scripts; skips2packages+1desktop. Original contention failure/stopped gates remain historical. Published evidence preservation fails R1. |

## Epic135 decisions and DoD

| Epic row | Disposition |
| --- | --- |
| Decision1 every bundled recipe/sub-recipe forkable except Simple | Scheduled141, not prematurely implemented; existing forks/frozen definitions retained. |
| Decision2 generic agent configuration plus listed non-agent blocks |140 adds generic human types with declared config, no new step-ID/name authority; broader migration stays later. |
| Decision3 library plus custom JSON Schema | Foundation retained, view-v1 library added; no removal of custom formats. |
| Decision4 declarative views/no HTML/scripts | Implemented and tested as untrusted display data. R2 concerns Ask execution powers, not injected HTML execution. |
| Decision5 dedicated Improve follow-up/reconsolidation/no research rerun |140 supplies separate generic Ask/no research rerun; actual Improve reconsolidation belongs141. R2/R4 must be fixed before reuse. |
| Decision6 delete old Improve outright/no migration |Correctly deferred141; old implementation not deleted early. |
| Decision7 inherit model unless explicitly set/note inheritance |Generic Ask inherits via existing runner settings; no hidden required worker model added. Broader Improve inheritance note remains141. |
| Decision8 foundation order |140 based on exact139 main after completed136–139;141–148 unchanged/queued. |
| Added144–148 audit scope/order |No premature implementation/performance, recovery-budget or later migration scope found. |
| One PR/ticket, latest main, ticket link |PASS PR177/basefa866b3d, Taskbot attachment219 and T3 child/parent links verified. |
| Green CI then guarded squash |PENDING coordinator only. I neither watched nor polled/retried CI; no merge authorization. |
| Existing tests, no unsupported weakening |PASS diff/full original gate review. Only full capability expected prompt changed; no timeout inflation or deleted security assertions. |
| Focused restart/retry/idempotency/concurrency/stale behavior |Substantial coverage passes, but confirmed R2/R4 and text/provenance/push triggers remain unprotected. |
| Full prompt assertions |PASS entire expected capability prompt updated and .verify() preserved. |
| Required local build/typecheck/lint/package gates |Authenticated source-equivalent originals pass; precise inputs below. No needless full replay. R1 published logs missing. |
| Applicable F1/report |Applicable human runtime/routing/activities; authentic controlled mocked EdgeWorker/CLI report attached220. Strong ordinary scenarios, not live provider quality; R2/R4 remain. |
| UI screenshots desktop/390 light/dark |PASS12 originals/authenticated view+resource identity;360 and keyboard receipts retained. |
| Capability reference/changelog/docs |PASS additive workflowTriggerInstructions/full expected prompt, views.md, contract row and user-facing PR-linked changelog. R2/R5/R6 mean claims require repair, not merely wording clearance. |
| Frozen definitions/forks/native conversations/original evidence/human decisions |No broad migration or old screen/Improve removal. Source review and full retained regression gates support foundation136 bounded config,137 assistance/sidecars,138 exact produced-output ownership and139 Snapshot/paused-child observation. Generic view receipts remain separate from native approval. New view-current ownership has R4. |
| Completion/epic closure/later work |PENDING parent after fixes, NEW independent candidate review and exact-head CI; epic remains open. |

## Independently executed checks and retained probes

Environment Node24.21.0/pnpm10.33.1. Every build/install/probe used own detached checkout or disposable homes.

1. `pnpm install --frozen-lockfile` exit0, no dependency changes. Built sibling dependencies with `pnpm --filter 'bobs-factory-edge-worker^...' build`, edge-worker with `pnpm --filter bobs-factory-edge-worker build`, and F1 helper with `pnpm --filter ./apps/f1 build`, all exit0. This was reviewer setup for real API/config probes, not a duplicated whole gate. Generated shell exactly32c73ab9807a3c6248b0d42f.
2. `pnpm --filter bobs-factory-edge-worker exec vitest run test/View.test.ts test/DeclarativeView.test.ts test/FactoryViewIntegration.test.tsx test/HumanViewsRuntime.test.ts test/HumanViewsApi.test.ts test/ViewAssets.test.ts test/ResearchPermissions.test.ts --maxWorkers=1` exit0:7files/116tests,17.78s.
3. `node /tmp/taskbot140-review-r1/probes.mjs` exit0: real runtime-created/persisted ordinary Ask,13 large items,two Shows, actual launched-child/late-Ask race and Codex native-config resolution. Results `probe-results.json`; separate homes retained. Original invalid disposable Launch mapping attempt retained separately as reviewer harness failure.
4. `node /tmp/taskbot140-review-r1/native-ask-config.mjs` exit0: actual EdgeWorker/CLI admission/worktree/Decide/Ask runner-creation boundary, exact captured config→production CodexConfigBuilder, one mocked Ask/native identity and zero paid/native-provider calls. Receipt `actual-ask-config.json`; service stopped. Initial CLI teamId omission is a separately retained reviewer fixture error.
5. `node /tmp/taskbot140-review-r1/authenticate.mjs` exit0: complete input/tree/mode/byte coverage, archive and original-log hashes, resources and screenshot originals. Receipt `authentication.json`. Initial resource virtual-path mapping was corrected only in reviewer script; not a product defect.
6. Visually opened all12 exact PNGs. Source/PR checks and final remote identities/link inventories repeated without any CI operations.

## Authenticated reuse, exact identities and limits

- Final246 commit changes ONLY CHANGELOG.md, criterion report and pr-link-equivalence.json. Compared all1377 expected tracked non-doc/non-driver inputs against both667 Git blobs and246 tree/modes/current bytes: zero missing/mismatches. Manifest SHA256 `38749a1fb8a22b7579fa3c4d47f57a651e9d6a1ac5219bf9ed7e8017120f1c5c` independently reproduced. Full667→246 path audit contains only documented evidence/drivers/metadata, no production/test/dependency/resource change.
- Reconstructed all29 embedded resources with canonical build mapping/base64/order: digest `3107421db253d284c9749e79fd8d9e4cada0481153ba42a4069079df8ec68495` exactly. All8 individually retained compiled view/runtime/backend hashes match own build. The original whole-dist aggregate09c4f770… was NOT independently reproduced by my fresh build (aggregate62818161…); no whole-dist binary-equivalence claim is made from that fresh aggregate. Source inputs, individual critical backend files and embedded-resource identity are independently matched.
- All115 present archive entries match advertised hashes;71 missing are R1. All58 original gates /tmp logs exist and match raw-log-manifest. Original complete package serial log SHA `a163ada7b21c2392f1891ce68c271032d1f27b6e2a744cf97fcbccf2f74db233` contains all16 complete summaries, totaling4257passed/2skipped/335files; edge2933/1skip/227files. Apps255CLI+41desktop+17F1=313/1skip; scripts179/0fail; build/typecheck exit0 and lint1476files/0errors/37warnings authenticated. These are reused original results, not independently rerun whole suites.
- Historical e4e9 partial logc2297afc… and667 failed/stopped logb475efac… hash-match; second original CheckImpactRetention failed17176ms, original unchanged isolated tests pass12216/12813ms, final serial complete gate passes. Original assertion stack was not emitted before stop, so contention remains inference. No timeout/test weakening found; neither stopped run is a pass.
- Actual retained F1 final driver89cb2659…, source667,3scenarios/9mockturns/17protected requests/8activities/2persisted reconstructions/zero paid calls; original requests/accepted choices/digests and separate failures reviewed. This proves controlled orchestration, not actual native tool restriction (R2), live model/auth/forge/push quality or the missing R4 race.
-12 submitted PNGs match their actual original T3 screenshot artifact paths/bytes; key source/backend identity and shell/resources match. Reviewed raw accepted payload/retry/conflict,reconstruction,Ask draft/new digest,keyboard,builder and six settled360 audits. No OS screen-reader/live-device claim.
- Native binary actual retained file hash `f339509e52e4c4ddfee0ed4088f8fb4188dd0b00b9c83e88d85271d295a3fd82`,113265522bytes independently matched. Embedded identity667/Bun1.4.2/darwin-arm64/dirty:true retained honestly; it is not a clean246 release binary. Original standard native startup/assets/protectedAPI/scopedMCP/shutdown/restart smoke and26response catalogue/schema/preview/save/reconstruction receipt authenticated. Native attempts1/2 remain separate fixture failures. No other target/minOS/native-agent-human-workflow claim, release rerun or deployment.
- Review artifacts and full report retained at `/tmp/taskbot140-review-r1/`; clean detached checkout retained. No finding was cleared on implementation's future repairs.

**Conclusions:** Standards1confirmed P1(R2). Spec5confirmed gaps(R2–R6), worst within Spec P1(R2,R4). Evidence-preservation1confirmed P2(R1). Six unique consequential findings overall. NOT CLEAN; parent must obtain repairs and a NEW independent exact-candidate acceptance round before merge consideration.

