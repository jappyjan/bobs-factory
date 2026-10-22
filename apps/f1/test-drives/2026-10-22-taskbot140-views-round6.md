# Taskbot140 — round5 R3A ambiguity and asset-queue repair

[PR177](https://github.com/jappyjan/bobs-factory/pull/177), [Taskbot140](https://taskbot.apps.janjaap.de/p/bobs-factory/t/140), epic135; predecessor139/PR176. Retained checkout `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-140-views`, branch `taskbot/140-views`; manual checkout did not change inherited T3 app binding. Latest fetched base/main remains `fa866b3d18a880a72fb59f19bfc88195cd4db762`.

This responds only to authoritative round5 report2261's stable **R3A/P2**. Published9f50 remains immutable in history. R1/R2/original R3 text/R3B/R4/R5/R6 were independently clear on9f50; their regressions remain. This candidate requires a NEW independent **round6** and exact-head CI, owned by the parent. No acceptance clearance, status/CI/merge/release/deployment/production/later-ticket action is claimed.

## Root cause, correction and regression

| Root cause | Minimal correction | Consequential production regression |
| --- | --- | --- |
| MCP guarded every invoking POST/stdin frame. Later ping/cancellation could overwrite the original dispatched call's ambiguous outcome with typed UNSENT. | Bind authority out of band to the exact SDK-generated tools/call envelope and full serialized request/ID. Protocol replies and cancellation never acquire mutation authority. Validate every actual matching handoff after preparation; once a mutation has crossed handoff, a later refusal retains uncertainty, including redirects. Unsupported outgoing batches fail explicitly. No authority is serialized into provider args. | Actual configured HTTP stored-comment + real child change + correlated ping reply/abort retains the original error/ID/body; actual stdio and legacy SSE ping request/reply positive controls. Existing held initialize, real MachineCapacity, native Codex startup/framing and known-unsent suppression regressions remain. Redirect test keeps zero obsolete final-endpoint calls but now requires original reconciliation after the first POST. |
| Taskbot checked currentness before reading the original remote marker, so a newer Ask digest retired an ambiguous accepted original as unsent. | Durably retain the original Taskbot wire body with pending/absent/confirmed state before provider preparation. Reconcile exact original marker AND body before any currentness retirement, including genuine old/crash-gap receipts. Unknown or conflicting lookup retains the obligation; only conclusive absence allows obsolete retirement. New digests retain distinct IDs. No provider confirmation is fabricated. | Actual production runtime/Taskbot/configured HTTP stores the original comment then loses response; normal Ask advances; original marker confirms delivery without duplicate. Actual EdgeWorker/HTTPS versions cover protocol-result failure and disconnected response, real child change, held original lookup, distinct IDs/current answer/restart. Additional production adapter cases cover unavailable lookup, different body and conclusive absence across reconstruction. |
| Protected bytes were verified outside the lock, then that boolean aged while a competing private native checkpoint waited on durable storage. | Retain bounded canonical path/device/inode/size/ctime/mtime/mode stamps from verified byte reads; compare synchronously at final local handoff. A competing transition also forces bounded byte/revision revalidation outside the lock; repeatedly unsettled authority defers rather than supersedes. Byte/Git/model/provider waits stay outside the short transition. No absolute filesystem/provider atomicity is claimed. | Real capture-v1 → Decide screenshot → Ask with production checkpointAgent/save and an instrumented acknowledgement delay. Changed real PNG suppresses tools/call while the original capture/native identity remains; unchanged PNG still dispatches. Supplemental compiled-runtime HTTP drive retains original scheduling/75ms-storage qualification; no source/receipt/answer/progress patch. |

Earlier native Linear outbox known429/pacing/recovery/original-ambiguous-session/input reconciliation and native Codex initialized/connected handoff remain unchanged and freshly regression-tested. No remote/model wait holds the human transition, and no stale human approval is waived. This enforces the existing capability promise; the full capability prompt is unchanged and retains its complete expected-prompt assertions.

## Frozen source and gates

Source `3ae23b333c70f11650e25f0f781448b8b2310fb2`, tree `e45717f357dece093916ef5ae59f50e2d2749d60`; input fingerprint `e0a2455fd02c2b37b8e86a4743abb2811ec8edd8a5912ea73344d845d08d3bc6`. Later report/archive commits change evidence only. Node24.21.0/pnpm10.33.1/Bun1.4.2, native macOS ARM64 only. This repair changes no dependencies; the prior workspace-only `mcp-tools -> core` link remains, with no external version or override change. Frozen installation and audit are fresh. The preexisting non-runtime backup remains its original133-byte Git LFS pointer; hydrated private bytes are neither read nor exported.

| Command | Fresh result |
| --- | --- |
| Frozen install / dependency audit | Exit0 / exit0, zero advisories. No dependency changes in this repair; no external version change in the prior workspace-only core link. |
| `pnpm build` / `pnpm typecheck` | Exit0 / exit0. |
| `pnpm lint` | Exit0: 1512files,0errors,39warnings (37retained +2unused imports in the supplemental evidence driver; no new production warning). |
| `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm test:packages:run` | Exit0: 4399passed/4skipped,16packages; 347passed files+1native opt-in file skipped. Edge3003passed/1skipped/231files. |
| Serial `pnpm -r --filter './apps/*' test:run` | Exit0:255CLI+41desktop+17F1=313passed,1desktop skip. |
| `node --test --test-concurrency=2 scripts/tests/*.test.mjs` | Exit0:179passed,0fail/skips. |
| Actual current EdgeWorker/CLI F1 | Exit0:6root runs/7named rows,41protected requests,9activities,13scripted role constructions+1actual unavailable-native start,zero paid calls. |
| Additional actual EdgeWorker HTTPS/admission + supplemental native runtime/outbox drives | All exit0:4actual EdgeWorker transport/history scenarios,1instrumented asset queue and2native durable/paced scenarios,zero paid calls; original requests,IDs,accepted answers and restarted outboxes retained. |
| Native ARM64 compilation / standard smoke / view smoke | All exit0; isolated startup/assets/protectedAPI/scopedMCP/shutdown/restart and26actual catalogue/schema/save/preview/reconstruction responses, explicitly0runs/0provider executions. |


[Commands/exits/timings/hashes](assets/taskbot140-views/round6/gates/gates.json.raw), [complete source inputs](assets/taskbot140-views/round6/gates/source-inputs.json.raw), [full package log](assets/taskbot140-views/round6/gates/packages.log), [package totals](assets/taskbot140-views/round6/gates/package-counts.json), [input equivalence](assets/taskbot140-views/round6/input-equivalence.json). Source was unchanged throughout sequential gates; packages use ONEworker/serial workspace. Full capability/prompt assertions remain entire expected prompts. The fix enforces the existing promise, so it does not change capability wording again.

Focused stabilization passed66edge tests/3files, followed by the final2-case changed/unchanged checkpoint-queue run (67distinct edge cases across those runs),5owning MCP transport tests and owning type checks. The final24-case human-ticket file retains all prior17 cases and adds7 consequential cases. Existing new140 redirect coverage still requires zero obsolete final-endpoint writes, but its error now preserves the first POST's uncertain outcome rather than asserting definitely UNSENT. Real stdio/SSE ping replies and correlated HTTP request/reply IDs remain inert data; no agent argument grants dispatch authority. The frozen full suite below supersedes historical dirty-source focus evidence. No original foundation/security assertion or timeout was weakened.

## Current drives, binary and identities

Main actual EdgeWorker/CLI: driverSHA `645608d657da93094d9fa2a0ed7fee057ccf7dbd42279f93cd297774ef494b0f`, clean3ae23/treee457; backend source fingerprint `686ea3180d540a5c95c8729e0684152417b039f30ddfba9d57a6e8a1090c65ae`, measured compiled aggregate `5fe5f3368e4f294bed9265e05734ec3dc7251e5d1a0f9b0b4c7c89e646f4df8e`.6root runs/7rows,41protected requests/9activities,13scripted role constructions plus1actual unavailable no-model Codex start,zero paid calls. Additional actual EdgeWorker/manual API/HTTPS MCP:4scenarios,108wire requests/16protected requests/8scripted turns,driverSHA `f19d57400392150a1b16b439052b712d24628ff2473d6acb9e66b0993c2658eb`. Supplemental native runtime/SDK/service/outbox/budget:2scenarios including known429 recovery,driverSHA `475832b009886d71daa11a801d1cba67c08b156e7dcafd3f384bb9eded6c1503`. All supplemental drives havezero paid calls and exact3ae23 identity. The instrumented real-asset/checkpoint queue driverSHA `02eab25050032ce8a6c671f1bbe41e614fcc7fddc08a49c1eb877203dbe3a541` retains the controlled75ms durable-save scheduling qualification. The4-scenario Edge drive uses a controlled original JSON-RPC error after a real correlated ping response, and actual response disconnection; focused runtime tests separately exercise abort/loss. Original lookup is held until ordinary Ask advances so genuine uncertainty is observed before confirmation.

[Main EdgeWorker/CLI results](assets/taskbot140-views/round6/f1/results.json.raw), [HTTP/accepted requests](assets/taskbot140-views/round6/f1/http-receipts.json.raw), [scenario receipts](assets/taskbot140-views/round6/f1/scenario-results.json.raw), [native Ask configurations](assets/taskbot140-views/round6/f1/native-config-captures.json.raw), [activities](assets/taskbot140-views/round6/f1/activities.json.raw).

[Actual EdgeWorker HTTPS/admission receipt](assets/taskbot140-views/round6/f1-dispatch/receipt.json.raw), [its raw child stdout](assets/taskbot140-views/round6/f1-dispatch/stdout.log), [native runtime/service/outbox/budget receipt](assets/taskbot140-views/round6/f1-native-queue/receipt.json.raw). Each final executed driver is copied byte-for-byte with its actual clean source identity. Configured MCP uses a freshly generated loopback-only TLS certificate and isolated synthetic home; certificate private keys/incidental homes are not advertised/exported. Main plus HTTPS drives execute actual EdgeWorker paths; the supplemental native drive explicitly uses production WorkflowRuntime/native adapter/Linear SDK/service/outbox/budget with synthetic CLI issue/session data and controlled SDK transport/agent hooks, not live native-origin authentication.

[Current compiled dispatch/backend hashes](assets/taskbot140-views/round6/runtime-identity.json.raw) also pin core control, configured MCP, Codex MCP and Linear outbox/service/budget. The measured main F1 compiled aggregate covers its four-package/TUI/MockAgent scope; it is not a whole-workspace or independently reproduced aggregate claim. Complete source inputs and additional compiled Linear hashes cover the changed native backend separately. The historical66709c4f770 versus reviewer62818161 aggregate limitation remains qualified.

Fresh Factory executable **113447154bytes**, SHA256 `72bee45cad8b0060060ebb3931b8888e4a4ca7469e99db229253ba03a2a4bce6`, clean3ae23/Bun1.4.2/version1.0.0-beta/darwin-arm64.29-resource digest `5b6465f16a8165035ecbb5bca53e826908862495714dbd8e87ebd3dbc65dff59`. This is not an independently reproduced whole-dist aggregate claim.

[Original build metadata](assets/taskbot140-views/round6/native/build/build.json.raw), [standard smoke](assets/taskbot140-views/round6/gates/native-standard-smoke.log), [26-response native view smoke](assets/taskbot140-views/round6/native/views/attempt-2026-10-22T12-27-07-105Z-1a08efb2/native-views.json.raw). Original build metadata's pending-smoke field is not rewritten; separate actual smoke receipts establish results. This is a local validation binary for 3ae23 source, not a release or later documentation-head binary. The compiled executable embedsBun1.4.2; Git and native coding agents remain external prerequisites. No other target/minimum OS/live model/real native credential/history/forge/device claim.

[Actual current EdgeWorker transport/history receipt](assets/taskbot140-views/round6/f1-dispatch/receipt.json.raw), [instrumented protected-asset/checkpoint receipt](assets/taskbot140-views/round6/f1-assets/receipt.json.raw), [native durable queue receipt](assets/taskbot140-views/round6/f1-native-queue/receipt.json.raw).

## Unchanged UI/provider evidence, precise scope

[Current reuse proof](assets/taskbot140-views/round6/reuse/proof.json.raw) verifies10 unchanged renderer/public-text inputs, all23 original PNGs,8 owning OpenCode proof source/dist inputs and10 owning Codex native-proof inputs. Shell b6c096735522dd1c43f9750f/29 resources remain byte-identical. The12desktop/390 light/dark Decide/Approve/run-list,8builder and3safe-native-failure/subsequent-answer images retain their original actual inspections,360 audits, keyboard/Save/error/delayed-response identities. Four initial visible projection equalities remain historical94 evidence; no changed-backend equivalence is inferred. No new browser replay/screenshot/OS-reader execution is claimed.

[Required matrix and builder images](2026-10-22-taskbot140-views-round2.md), [desktop failure](assets/taskbot140-views/round3/ui/failure-desktop-light.png), [390 dark failure](assets/taskbot140-views/round3/ui/failure-390-dark.png), [390 dark answer](assets/taskbot140-views/round3/ui/answered-390-dark.png). Changed runtime/MCP/native delivery is excluded from reuse and freshly validated above.

Pinned OpenCode1.2.27 synthetic legacy refusal/initialized metadata/original-ID resume and Node/Bun read-only metadata proof is reused only for8 unchanged owning inputs. Codex0.163 effective-config/OS-denial proof is reused only for10 unchanged owning permission inputs, not the changed generic MCP/native dispatch modules. Current full owning configuration/start/resume and controlled native-process framing suites validate the current source. Supplemental native runtime drives use controlled SDK transport; actual HTTP serialization is exercised by owning production service/outbox tests, without claiming a live provider or native-model turn. No native live-model/auth quality or transitive whole-program equivalence is claimed.

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
| Native ticket replies / Taskbot comments | Exact digest-bearing /view-answer, free text cannot approve; actual post-Ask current publication, long-text guidance, Taskbot+Linear adapters, retry/restart/out-of-order, held provider reads/transcript preparation, actual downstream HTTPS initialize/capacity admission, original protocol/response ambiguity reconciliation, native durable/paced retry/recovery, real child-source renewal and protected asset/checkpoint queue tests. Taskbot inbound ingestion stays inapplicable. |
| Push and all component text | Default private/frozen queued behavior intact; trusted explicit view-text consent, all14 component serialized-payload/worker tests, retained safe failed-Ask event text/current regression suite, bounded exact identity/digest/dedup/reconstruction. No live device send. |
| Restart/history/concurrency | Exact accepted outputs/native identities/definitions preserved; authentic old stores, normal waits, Ask completion/publication, legacy retry/crash recovery and real child R4 race, R3A pre-write renewal, original ambiguity and local asset authority protected. |
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
| Gates/F1/UI/docs | Fresh stable-source required gates, actual F1/native/current dispatch flows, precisely bounded UI reuse, PR-linked changelog and maintained view documentation. |
| Frozen definitions/accepted answers/history/native stores | No broad rewrite; private raw historical diagnostics retained; pending safety projection renews current digest; original accepted receipt/output unchanged. |
| CI/status/merge/epic completion | Parent only, NEW independent round6 required. No acceptance/merge/main-green/release/website claim for this revised candidate. |




## Submitted archive, failures and limits

[Fresh Git-export verifier](assets/taskbot140-round6-archive-verify.mjs), [cumulative inventory](assets/taskbot140-views/round6/archive-sha256.json), [original-byte mappings](assets/taskbot140-views/round6/original-copies.json), [archive notes](assets/taskbot140-views/round6/archive-notes.md), [submitted proof](assets/taskbot140-views/round6/submitted-archive-proof.json). The verifier checks the complete tracked non-evidence input set/modes/literal bytes, retained/current drivers, all archive hashes/relative report links and original186 verifier from a fresh Git export. Literal symlinks and the non-runtime LFS pointer are checked without following/exporting private backup data. Original186 SHA3b0b2aba… and prior577/707/838 inventories remain pinned byte-identical. A separate exact-final-tree exported receipt avoids self-referential commit/hash claims.

[Focused original outputs](assets/taskbot140-views/round6/focused/taskbot140-r6-ticket-final-focused.log), [original reviewer protocol negative](assets/taskbot140-views/round6/review-r5/ambiguous-protocol-probe.json.raw), [original response negative](assets/taskbot140-views/round6/review-r5/ambiguous-original-probe.json.raw), [qualified original asset queue negative](assets/taskbot140-views/round6/review-r5/asset-queue-probe.json.raw). All original rounds/source variants/stops/native/provider/UI failures remain historical. New pre-freeze outputs retain the original two ambiguity reds, first transport type error, formatter error, and all driver attempts. The first new Edge driver hold matched an unescaped colon rather than the escaped fallback, was stopped explicitly (SIGTERM; parent exit1), and has exact executed bytes/partial output. Later setup waits expected an SSE close to terminate a resumable call; their real15s assertion failures remain separate. The final Edge driver uses a controlled original JSON-RPC result error after the real ping reply; focused runtime regression separately uses real abort/loss. No product/test deadline was inflated. An additional held original lookup makes the genuine ambiguous state observable before ordinary Ask advances; this scheduling qualification is explicit. Exploratory PASS receipts identify dirty9f50 source and are historical driver stabilization only, not proof of immutable9f50 or this clean freeze. Final executed driver bytes and all claimed original gate/native/failure receipts are submitted with hashes. No failed/stopped run is a PASS, no timeout/assertion weakening, no paid/production/status/CI/release/later action. Parent runs a NEW independent exact-candidate review and owns CI/merge/main health.

An optional metadata-copy filename typo during assembly is retained in the [observed transcript](assets/taskbot140-views/round6/historical/assembly-error-transcript.txt), beside the genuine preliminary index proof. The rebuilt final archive/proof covers corrected metadata. [Final remote main identity](assets/taskbot140-views/round6/final-main.txt) still matchesfa866; this is an identity read, not a new CI/main-health claim.
