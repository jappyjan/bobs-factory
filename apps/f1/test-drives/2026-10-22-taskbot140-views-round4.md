# Taskbot140 — round3 R3A delivery repair

[PR177](https://github.com/jappyjan/bobs-factory/pull/177), [Taskbot140](https://taskbot.apps.janjaap.de/p/bobs-factory/t/140), epic135; predecessor139/PR176. Retained checkout `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-140-views`, branch `taskbot/140-views`; inherited T3 binding remains the coordinator checkout. Base/latest fetched main `fa866b3d18a880a72fb59f19bfc88195cd4db762`.

This responds only to authoritative round3 report2230's residual **R3A/P2**. Reviewed94 remains immutable in history. R1/R2/R3B/R4/R5/R6 were independently cleared on94; their regressions remain. This revised candidate needs a NEW independent round4 and exact-head CI, owned by the parent. No acceptance clearance, status/CI/merge/release/deployment/production/later-ticket action is claimed.

## R3A response

| Root cause | Minimal correction | Consequential regression |
| --- | --- | --- |
| The outbox compared retained batch/public digests. Live declared `@childRuns` could change during a provider read while those digests stayed equal; a newly delivered running-child command then failed the stronger answer validator. | A runtime-owned final validator resolves the exact active leaf/frame/batch/status and current declared configuration/content, verifies protected assets outside the short human transition, then rechecks ownership/content before authorizing a write. An obsolete unsent record is superseded durably and the existing wait is awakened to create a normal renewed batch. It never creates acceptance. The production EdgeWorker supplies this authority; missing authority fails closed for human-view writes. | Actual saved Launch(wait:false)→Decide→held Ask, actual Taskbot get_ticket or Linear fetch held, actual child completion, release read: no old pending/running-child write, exact renewed completed-child protocol, stale denial, accepted renewed choices while old Ask remains pending, original delivered history and historical late Ask unchanged. |
| Linear performs asynchronous transcript-session preparation inside publish, after generic outbox preparation. | Native adapter invokes the same runtime validator after transcript lookup/creation and immediately before activity creation. A declined write stays unsent/superseded. Marker/delivery-ID reconciliation and original sent histories remain. | Held production nativeAdapter transcript preparation plus real child completion reproduces the old window and passes with the fix. Real protected-file mutation denies delivery without changing accepted capture history; renewed batch reconstructs without obsolete replay. |

The final check is local and bounded. No human transition spans a remote read/write or model wait, no capacity/shared execution lease is acquired, and no approval authority is inferred from data. A provider operation and a later filesystem/child update cannot be made atomic across processes; subsequent content changes still require fresh review. Existing uncertain-delivery marker/ID reconciliation remains, without claiming exactly-once remote effects.

## Frozen validation

Clean source `3111f7692c7cfcd1046dd933784691930f0db1d3`, tree `4f02c8500082ff1e747bef275091004f309b6200`; full input fingerprint `92a93c75a336ebd2c9d6a6ada0814d04af1ee03db5b5977af8c069bb248ff37b`. Later archive/report commits change evidence only. Node24.21.0, pnpm10.33.1, Bun1.4.2, macOS26.6.2 ARM64. Dependencies/lockfile unchanged. One preexisting non-runtime backup is handled only as its original133-byte Git LFS pointer; hydrated private payload is never read/exported.

| Command | Fresh result |
| --- | --- |
| `pnpm build` / `pnpm typecheck` | Exit0 / exit0. |
| `pnpm lint` | Exit0: 1499files,0errors,37 retained warnings. |
| `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm test:packages:run` | Exit0: 4369passed/4skipped,16packages; 344passed files+1native opt-in file skipped. Edge2992passed/1skipped/231files. |
| Serial `pnpm -r --filter './apps/*' test:run` | Exit0:255CLI+41desktop+17F1=313passed,1desktop skip. |
| `node --test --test-concurrency=2 scripts/tests/*.test.mjs` | Exit0:179passed,0fail/skips. |
| Actual current EdgeWorker/CLI F1 | Exit0:6root runs/7named rows,41protected requests,9activities,13scripted role constructions+1actual unavailable-native start,zero paid calls. |
| Native ARM64 compilation / standard smoke / view smoke | All exit0; isolated startup/assets/protectedAPI/scopedMCP/shutdown/restart and26actual catalogue/schema/save/preview/reconstruction responses. |


[Exact original commands/exits/timings/hashes](assets/taskbot140-views/round4/gates/gates.json.raw), [complete source inputs](assets/taskbot140-views/round4/gates/source-inputs.json.raw), [complete package log](assets/taskbot140-views/round4/gates/packages.log), [counts](assets/taskbot140-views/round4/gates/package-counts.json), [input equivalence](assets/taskbot140-views/round4/input-equivalence.json). Source remains frozen throughout sequential gates. Full prompt assertions and every original consequential assertion/timeout remain; these fixes enforce an existing promise, so capability wording/full expected prompt do not change again.

Focused stabilization: original source-only Taskbot/Linear regression failed twice on94; new held-transcript regression failed once on20dc. Current80tests/4files pass (13ticket+24human-runtime+5real-file+38tracking), with production API/adapter behavior rather than source-text assertions. One missing-explicit-return TypeScript attempt was corrected and retained. Existing140 test fixture gains real Launch/capture producers and transport holds; no preexisting foundation/security assertion is changed.

The first frozen998 drive stopped exit1 before packages: its old refresh helper mistook the first automatically renewed batch for a completed-child display. The final helper retains stale409 and immutable-original-answer assertions, sends a deliberately invalid current digest (never authority), and requires visible child status completed before explicit final approval/changes. The20dc drive then passed; its package gate was deliberately stopped after7.6s/SIGTERM when seam inspection found the Linear transcript wait. Those source-changing results are historical, with exact original output, source identities and partial summaries retained. No stopped/failed attempt is a pass, no timeout increased.

## Actual current F1 and native

F1 applies to runtime/Ask/lifecycle/ticket delivery. The real EdgeWorker/CLI drive uses saved generic recipes, local Git/worktrees and controlled scripted providers. It preserves Decide choices/follow-up/alternate routing, Approve stale/changes/exact acceptance, waiting/reconstruction/native Ask identity, malicious data inertness and safe native failure/public channels. The changed scenario holds the actual local tracker fetch used by the production adapter/outbox, completes the actual child, then releases the read. Its obsolete pending intent never appears in originating ticket comments; the renewed text shows completed, retains prior sent comments, and its exact protocol is explicitly answerable after restart. Taskbot's actual get_ticket transport and Linear's held transcript boundary are additionally executed in focused/full tests.

Executed driver SHA256 `30448b1a753d964c29e823b743ef23484055c5ff7cca085787afb37fb03f7428`; source3111/tree4f02, backend fingerprint `c50c01c94e90969f3ec45c5dd76c974b925c367ee44721b213261ebd4a453351`, measured local whole-dist `19a5b6c73a396191e94155c326355413b5e4b197287199c824159bf2fb5235ac`. Six saved root runs/seven named rows,41protected requests/9activities,13scripted role constructions plus one actual unavailable Codex start; title mocks are separate.

[F1 results](assets/taskbot140-views/round4/f1/results.json.raw), [original HTTP requests](assets/taskbot140-views/round4/f1/http-receipts.json.raw), [scenario bodies/accepted receipts](assets/taskbot140-views/round4/f1/scenario-results.json.raw), [actual runner configuration](assets/taskbot140-views/round4/f1/native-config-captures.json.raw), [critical compiled backend hashes](assets/taskbot140-views/round4/runtime-identity.json.raw), [activities](assets/taskbot140-views/round4/f1/activities.json.raw), [complete output](assets/taskbot140-views/round4/gates/f1.log). Native model quality/auth/forge/device delivery is unclaimed; paid calls zero. Counter mockTurns includes one actual unavailable no-model Codex start, identified separately from scripted role constructions.

Fresh Factory executable **113397618bytes**, SHA256 `5640095c49f860b905671362a8ddbadbcda7dc09c92931b3771661fadcb17a81`, clean3111/Bun1.4.2/version1.0.0-beta/darwin-arm64.29-resource digest `5b6465f16a8165035ecbb5bca53e826908862495714dbd8e87ebd3dbc65dff59`. This is not an independently reproduced whole-dist aggregate claim.

[Original build metadata](assets/taskbot140-views/round4/native/build/build.json.raw), [standard native smoke](assets/taskbot140-views/round4/gates/native-standard-smoke.log), [native26-response view receipt](assets/taskbot140-views/round4/native/views/attempt-2026-10-22T10-01-14-384Z-83d5ede9/native-views.json.raw). Original build metadata retains its pending-smoke field; separate actual smoke receipts establish results. This is a local validation executable for the frozen source, not a release or documentation-head binary. Other targets/minimum OS/native-model workflows are not claimed. Local whole-dist F1 hash is a measured identity, not independent reproducibility; the original66709c4f770 versus reviewer62818161 aggregate limitation remains historical and qualified.

## Precisely scoped reuse

[Current input/PNG reuse proof](assets/taskbot140-views/round4/reuse/proof.json.raw) checks10 unchanged renderer/public-text inputs, all23 retained image bytes, eight actual OpenCode proof source/dist inputs and10 owning Codex native-proof inputs. Shell `b6c096735522dd1c43f9750f`/29 embedded resources remain exact. Original12 desktop/390 light/dark Decide/Approve/run-list images, eight builder images and three safe native-failure/subsequent-answer images are retained and inspected in prior authenticated rounds. Their actual360/keyboard/Save/errors/delayed-response receipts retain original provenance. Four initial visible projection equalities are historical94 proof, not newly executed projections or changed-backend equivalence. No browser replay or new screenshot is claimed for this backend-only repair.

Image links: [required matrix/builder](2026-10-22-taskbot140-views-round2.md), [desktop safe failure](assets/taskbot140-views/round3/ui/failure-desktop-light.png), [390 dark failure](assets/taskbot140-views/round3/ui/failure-390-dark.png), [390 dark answer](assets/taskbot140-views/round3/ui/answered-390-dark.png). Current delivery/backend/source/assets/digest behavior is excluded from reuse and receives the fresh tests/F1/native above. No OS screen-reader execution claim.

The pinned OpenCode1.2.27 synthetic native legacy refusal/initialized metadata/resume proof is reused only for exact eight owning source/dist inputs, with original bytes/binary/driver retained in [round3 provider receipt](assets/taskbot140-views/round3/native/provider/receipt.json.raw). It proves zero native invocation/noDB/import for unsupported legacy state, Node/Bun read-only metadata and original-ID refusal; no live model call. Codex0.163 effective config/OS-denial proof likewise has10 exact unchanged owning inputs. Full current package tests still execute owning start/resume/config restrictions. Existing safe public/private error, default-private trusted opt-in push, builder provenance and historical Ask ownership remain covered.

## Complete140 criterion response

| Requirement | Current response/evidence |
| --- | --- |
| Schema/component list and literal/JSON-pointer roots | Shared strict view-v1 validation remains at save/render/runtime; bounded declared lexical inputs/item/index only. Full current contract/API/package suites. |
| Agent library view | Actual saved composed F1 emits validated view-v1 and consumes it through ordinary Call bindings; no agent authority from labels/actions/notification text. |
| markdown | Real inert renderer + escaped useful text; component/malicious-input suites. |
| checklist | Actual state/detail renderer and checked/partial/open text. |
| before/after | Paired labelled renderer and text sections. |
| chart | Numeric bar/line series, values/labels and textual series. |
| screenshots | Same-run protected inventories/hashes/alt/caption; empty selection and five real-file size-before-read/mutation/hash/index/foreign-path tests retained. |
| video | Protected verified same-run inventory/revision/hash, visible transcript and useful text; no live video/OS-reader claim. |
| table | Native headers/bounded scalar rows and meaningful text. |
| code reference | Bounded repository-relative ref/lines/inert excerpt; no arbitrary filesystem fetch/execution. |
| steps | Ordered status/detail and numbered text. |
| points | Labels/details and safe click-only credential-free HTTP(S) links. |
| item cards/actions/comments/details/Ask | Trusted recipe actions/stable IDs, per-action comments, expandable detail and native persisted dedicated context-only Ask. Retained R2/R3B permissions/privacy plus fresh R3A delivery/F1; no source agent rerun. |
| choices/form | Labelled native controls/options/required exact fields and useful text. |
| run list | Real Launch waves/statuses/child navigation, actual controlled child F1; completion never grants merge proof. |
| sticky decision bar | Explicit recipe-owned acceptance/actions, mobile/keyboard semantics; unchanged required matrix plus retained360 audits. |
| Decide outputs/routes | choices/itemsByAction/followUps/hasFollowUps, optional comments/form fields and ordinary branches in actual composed/alternate F1. |
| Approve/Request changes/exact display | Explicit accepted:true, required changes feedback, exact server batch/config/source/assets/thread digest; stale/concurrent/restart tests and actual F1. Original native approval/recovery/merge authority remains separate. |
| Show | Nonblocking, no human wait/decision push/long execution lease; actual concurrent Call/For each and run-list F1. Blocking concurrent humans remain explicitly prohibited, matching foundation single-human ownership. |
| Dashboard/API | Explicit exact current protocol, protected modes, idempotent/conflicting acceptance, no internal raw records/native errors; real F1 and current API tests. |
| Terminal | Current batch/digest/protocol survives bounds/history; discussion/status/failure guidance via production formatter; actual TodayApp frame and CLI tests. |
| Native ticket replies / Taskbot comments | Exact digest-bearing /view-answer, free text cannot approve; actual post-Ask current publication, long-text guidance, Taskbot+Linear adapters, retry/restart/out-of-order, held provider reads/transcript preparation, live child-source renewal and real asset-denial tests. Taskbot inbound ingestion stays inapplicable. |
| Push and all component text | Default private/frozen queued behavior intact; trusted explicit view-text consent, all14 component serialized-payload/worker tests, retained safe failed-Ask event text/current regression suite, bounded exact identity/digest/dedup/reconstruction. No live device send. |
| Restart/history/concurrency | Exact accepted outputs/native identities/definitions preserved; authentic old stores, normal waits, Ask completion/publication, legacy retry/crash recovery and real child R4 race and R3A source-only pre-write renewal protected. |
| All component text fallbacks | Useful inert text for14 components; current decision before Shows; bounded discussion/status, exact protocol reserved, explicit incomplete/complete-dashboard guidance. |
| Builder schema/errors/Save | Production JSON validation/autocomplete/sample/last-run controller unchanged; full current API/controller tests and exact unchanged8-image appearance evidence. Invalid Save remains disabled. |
| Last-run preview provenance | Exact requested/current configuration/workflow ownership and obsolete-response guard preserved; accepted source-input provenance remains distinct. R5 regression suite current. |
| 360px / themes / accessibility | Original full6 theme/page360 audits and required12 images,8 builder images with bounded proof; retained failed+answered360 no overflow, actual T3 semantic inputs/status/retry. No OS screen-reader claim. |
| Tests/E2E/malicious/full suite | All required fresh gates below; actual saved composition/routing/stale/restart/native error/publication F1, inert markup/media/code/URL/descriptors/prototypes/getter/toJSON negatives retained. |

## Epic135 and delivery constraints

| Epic decision/DoD | Response |
| --- | --- |
|1 fork bundled except Simple | Scheduled141, no early change. |
|2 generic agents + listed non-agent blocks | Generic140 human configuration retained; no new step-ID/name authority. |
|3 library + custom JSON Schema | Foundation retained; view-v1 library coexists with custom formats. |
|4 declarative/no HTML/scripts | Shared schemas, inert render/text and malicious input tests. |
|5 dedicated Improve follow-up/no research rerun | Generic dedicated Ask retained; Improve reconsolidation stays141. |
|6 delete old Improve/no migration | Deferred141; old screen/routine untouched. |
|7 inherit model unless configured | Original native runner/model/session/profile retained; no forced worker model/Snapshot. |
|8 strict foundation order +144–148 | Base exact139 main after136–139; no later-ticket/performance/migration work. |
| One PR/latest main/ticket links | Same177, predecessor139/176, exactfa base, child+parent links verified before handoff. |
| Existing safeguards/prompt assertions | Original assertions/timeouts/native/frozen/security outcomes preserved; described140 fixture-mechanism changes only. Full prompt assertions remain entire expected prompts. |
| Gates/F1/UI/docs | Fresh stable-source required gates, actual F1/native/current failure flow, precisely bounded UI reuse, PR-linked changelog and maintained view documentation. |
| Frozen definitions/accepted answers/history/native stores | No broad rewrite; private raw historical diagnostics retained; pending safety projection renews current digest; original accepted receipt/output unchanged. |
| CI/status/merge/epic completion | Parent only, NEW independent round4 required. No acceptance/merge/main-green/release/website claim for this revised candidate. |



## Submitted archive and limits

[Fresh Git-export verifier](assets/taskbot140-round4-archive-verify.mjs), [inventory](assets/taskbot140-views/round4/archive-sha256.json), [original-copy map](assets/taskbot140-views/round4/original-copies.json), [archive qualifications](assets/taskbot140-views/round4/archive-notes.md), [submitted proof](assets/taskbot140-views/round4/submitted-archive-proof.json). The verifier checks the complete tracked non-evidence input set/modes/literal bytes (symlinks use literal targets), current driver bytes, every submitted inventory/link and pinned original186 verifier in a fresh exported directory. Original186 inventory SHA `3b0b2aba788fdf7a3706e118eeba9c0ad47e167fb52fc9386192d604447216f1` remains unchanged. Original577 inventory/receipts remain bytes-identical too; newly collected files extend the current inventory. Final exact-head exported JSON is published separately to avoid a self-referential commit/hash.

[Focused originals/failures](assets/taskbot140-views/round4/focused/seams-final.log), [998 failed gate receipt](assets/taskbot140-views/round4/historical/998/gates.json.raw), [20dc stopped gate receipt](assets/taskbot140-views/round4/historical/20dc/gates.json.raw), [reviewer original source-race receipt](assets/taskbot140-views/round4/review-r3/runtime-probes.json.raw). Original667/666/339/3802/94 backend evidence is historical where changed, with raw failures/stops/native fixture limitations retained. No source deadline/test/assertion weakening, dependency changes, fabricated receipts/checkpoints, production effects, paid provider/device calls, CI operations or acceptance claim.
