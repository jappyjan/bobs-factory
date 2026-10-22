# Taskbot140 — round4 R3A final dispatch repair

[PR177](https://github.com/jappyjan/bobs-factory/pull/177), [Taskbot140](https://taskbot.apps.janjaap.de/p/bobs-factory/t/140), epic135; predecessor139/PR176. Retained checkout `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-140-views`, branch `taskbot/140-views`; manual checkout did not change inherited T3 app binding. Latest fetched base/main remains `fa866b3d18a880a72fb59f19bfc88195cd4db762`.

This responds only to authoritative round4 report2245's stable **R3A/P2**. Published53c remains immutable in history. R1/R2/original R3 text/R3B/R4/R5/R6 were independently clear on53c; their regressions remain. This candidate requires a NEW independent **round5** and exact-head CI, owned by the parent. No acceptance clearance, status/CI/merge/release/deployment/production/later-ticket action is claimed.

## Root cause, correction and regression

| Root cause | Correction | Production regression/evidence |
| --- | --- | --- |
| Ticket outbox validation preceded MCP runner capacity, initialize/header preparation and native startup. A real child could complete while an obsolete pending comment waited there. | A trusted local dispatch control travels separately from provider arguments. After preparation it invokes the write thunk in the runtime's short serialized final comparison of exact current frame/batch/status/public digest/configuration/declared content/protected assets. The returned provider promise is nested in an envelope and awaited outside that transition. Obsolete UNSENT work supersedes durably and wakes ordinary renewal; no acceptance is manufactured. | Actual WorkflowRuntime/Taskbot/callConfiguredTool HTTP initialize+real-child negative; actual complete EdgeWorker/manual API/verified synthetic HTTPS Taskbot with held initialize and MachineCapacity admission, old write suppressed, renewed protocol usable after reconstruction. Real asset mutation after initialize denies the write. |
| SDK HTTP/SSE headers and redirects await after client.callTool; stdio and native Codex have distinct dispatch points. | Guard HTTP/SSE POST fetch after headers, including same-origin redirects; guard stdio framing after initialization. Native Codex requires initialized/connected required MCP startup and guards the application-owned tool-call stdin frame after initialize/thread/status. Unsupported/unready authority fails before effect; no alternate transport fallback. No control or callback enters MCP args/headers/native params. | Actual HTTP/SSE/stdio transports, redirected-POST suppression and unchanged positive; controlled executable runs the production AppServerClient/startup/framing across3 held native stages and positive exact-argument calls, with no model/auth/native-history use. |
| Native Linear captures a second durable input and later waits for request pacing/OAuth retries. Its independent recovery could send known-UNSENT obsolete content after the outer receipt changed. | Persist strict private run/receipt/batch/digest/delivery identity beside the immutable provider input/fingerprint. Resolve through the current runtime on recovery and again after actual request-budget admission. Missing validator defers; obsolete known-UNSENT records retire without provider confirmation or ID reuse. Scope authority to the exact captured mutation, leaving inherited metadata reads/unrelated operations unguarded. Canonical retained pre-guard delivery IDs can bind without rewriting their original input. | Real factoryHome-backed Linear service/outbox/budget tests: held pacing+real-child progress,429 known-unsent/restart/missing authority, unchanged current, wire serialization, identity collision, ambiguity/current absence and concurrent reconciliation. Supplemental real runtime/native adapter/SDK/service/outbox/budget drive exercises2 persisted scenarios with actual child completion and renewed explicit replies. |
| Uncertain accepted/lost-response attempts must not be discarded merely because current content changed. | Serialize original-input reconciliation before any legacy binding/currentness supersession. Original delivery ID/session/content reconcile first; only conclusive absence or known rejection permits retirement/retry. Upper receipt reconciliation preserves confirmed delivered history. | Lost-response confirmed originals reconcile even without runtime authority; conclusive absent originals supersede without fabricated confirmation; concurrent recovery does not duplicate lookup/write. Original sent histories, IDs and accepted human receipts remain immutable. |

The final comparison starts the application-owned fetch/stdin/SDK request synchronously. It does not hold the human transition during model/provider responses. Native transport internals/network execution and later source/filesystem mutation after legitimate handoff are not an atomic transaction; later changes still require fresh human review. This is no exactly-once provider guarantee. The supplemental native queue's controlled clock advances beyond the recorded retry deadline; no product/test deadline or assertion is weakened.

## Frozen source and gates

Source `b25ae470b858b0e059603566ec144178ce38fee6`, tree `ec9dd8abaa5e7c103abb39a530fa2e7a65d1e945`; input fingerprint `4b24ea5c138c8b125c02f4d75286c3a96dd7c2a84b6b73ba5a5a6859e46734be`. Later report/archive commits change evidence only. Node24.21.0/pnpm10.33.1/Bun1.4.2, macOS26.6.2/25G83 ARM64. Added only workspace `mcp-tools -> core` for shared local authority/types; no external dependency version or override change. Frozen installation and audit are fresh. The preexisting non-runtime backup remains its original133-byte Git LFS pointer; hydrated private bytes are neither read nor exported.

| Command | Fresh result |
| --- | --- |
| Frozen install / dependency audit | Exit0 / exit0, zero advisories. Workspace-only core dependency added; no external version change. |
| `pnpm build` / `pnpm typecheck` | Exit0 / exit0. |
| `pnpm lint` | Exit0: 1507files,0errors,37 warnings. |
| `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm test:packages:run` | Exit0: 4390passed/4skipped,16packages; 347passed files+1native opt-in file skipped. Edge2996passed/1skipped/231files. |
| Serial `pnpm -r --filter './apps/*' test:run` | Exit0:255CLI+41desktop+17F1=313passed,1desktop skip. |
| `node --test --test-concurrency=2 scripts/tests/*.test.mjs` | Exit0:179passed,0fail/skips. |
| Actual current EdgeWorker/CLI F1 | Exit0:6root runs/7named rows,41protected requests,9activities,13scripted role constructions+1actual unavailable-native start,zero paid calls. |
| Additional actual EdgeWorker HTTPS/admission + supplemental native runtime/outbox drives | Both exit0,2scenarios each,zero paid calls; original requests,IDs,accepted answers and restarted outboxes retained. |
| Native ARM64 compilation / standard smoke / view smoke | All exit0; isolated startup/assets/protectedAPI/scopedMCP/shutdown/restart and26actual catalogue/schema/save/preview/reconstruction responses. |


[Commands/exits/timings/hashes](assets/taskbot140-views/round5/gates/gates.json.raw), [complete source inputs](assets/taskbot140-views/round5/gates/source-inputs.json.raw), [full package log](assets/taskbot140-views/round5/gates/packages.log), [package totals](assets/taskbot140-views/round5/gates/package-counts.json), [input equivalence](assets/taskbot140-views/round5/input-equivalence.json). Source was unchanged throughout sequential gates; packages use ONEworker/serial workspace. Full capability/prompt assertions remain entire expected prompts. The fix enforces the existing promise, so it does not change capability wording again.

Focused stabilization includes237edge tests/13files, with final17 human-ticket and39 Linear/4files after the last authority-scope/reconciliation refinements;22 Codex/3files and4 configured MCP/2files. These exercise real runtime/transport/configuration/permission behavior, not source-text assertions. New140 fixtures gained downstream transport/provider queues; no original foundation/security assertion or timeout was changed.

## Current drives, binary and identities

Main actual EdgeWorker/CLI: driverSHA `92c4190027b1c044633f886439660aa7d4f89ea8a807431dd6ac624781db6def`, cleanb25/treeec9d; backend source fingerprint `7ccb058b3af74bda519baf5391fa56d20d9217c1a3648c29b6fc860f6d8742c3`, measured compiled aggregate `65d86f2d191f4796f20fd81fa5bc71284014abafafc0c3fb4a60570dd5f247d0`.6root runs/7rows,41protected requests/9activities,13scripted role constructions plus1actual unavailable no-model Codex start,zero paid calls. Additional actual EdgeWorker/manual API/HTTPS MCP:2scenarios,47wire requests/8protected requests/4scripted turns,driverSHA `188b2fb5000c12f041c9aa4e6557fd9029c9ef4050755c36ee579bba5623de4b`. Supplemental native runtime/SDK/service/outbox/budget:2scenarios including known429 recovery,driverSHA `5abe1f614fb915b046c2b45253f8229243b3d2e3a1d76852f39a12c4bdf20091`. Both additional drives havezero paid calls and exact b25 identity.

[Main EdgeWorker/CLI results](assets/taskbot140-views/round5/f1/results.json.raw), [HTTP/accepted requests](assets/taskbot140-views/round5/f1/http-receipts.json.raw), [scenario receipts](assets/taskbot140-views/round5/f1/scenario-results.json.raw), [native Ask configurations](assets/taskbot140-views/round5/f1/native-config-captures.json.raw), [activities](assets/taskbot140-views/round5/f1/activities.json.raw).

[Actual EdgeWorker HTTPS/admission receipt](assets/taskbot140-views/round5/f1-dispatch/receipt.json.raw), [its raw child stdout](assets/taskbot140-views/round5/f1-dispatch/stdout.log), [native runtime/service/outbox/budget receipt](assets/taskbot140-views/round5/f1-native-queue/receipt.json.raw). Each final executed driver is copied byte-for-byte with its actual clean source identity. Configured MCP uses a freshly generated loopback-only TLS certificate and isolated synthetic home; certificate private keys/incidental homes are not advertised/exported. Main plus HTTPS drives execute actual EdgeWorker paths; the supplemental native drive explicitly uses production WorkflowRuntime/native adapter/Linear SDK/service/outbox/budget with synthetic CLI issue/session data and controlled SDK transport/agent hooks, not live native-origin authentication.

[Current compiled dispatch/backend hashes](assets/taskbot140-views/round5/runtime-identity.json.raw) also pin core control, configured MCP, Codex MCP and Linear outbox/service/budget. The measured main F1 compiled aggregate covers its four-package/TUI/MockAgent scope; it is not a whole-workspace or independently reproduced aggregate claim. Complete source inputs and additional compiled Linear hashes cover the changed native backend separately. The historical66709c4f770 versus reviewer62818161 aggregate limitation remains qualified.

Fresh Factory executable **113430642bytes**, SHA256 `75bebcd69b793e4b5d7dcd83636f5ff9d0808b4fa9ed348be9b613bc96dfe752`, cleanb25/Bun1.4.2/version1.0.0-beta/darwin-arm64.29-resource digest `5b6465f16a8165035ecbb5bca53e826908862495714dbd8e87ebd3dbc65dff59`. This is not an independently reproduced whole-dist aggregate claim.

[Original build metadata](assets/taskbot140-views/round5/native/build/build.json.raw), [standard smoke](assets/taskbot140-views/round5/gates/native-standard-smoke.log), [26-response native view smoke](assets/taskbot140-views/round5/native/views/attempt-2026-10-22T11-24-18-137Z-5b8cb96c/native-views.json.raw). Original build metadata's pending-smoke field is not rewritten; separate actual smoke receipts establish results. This is a local validation binary for b25 source, not a release or later documentation-head binary. No other target/minimum OS/live model/real native credential/history/forge/device claim.

## Unchanged UI/provider evidence, precise scope

[Current reuse proof](assets/taskbot140-views/round5/reuse/proof.json.raw) verifies10 unchanged renderer/public-text inputs, all23 original PNGs,8 owning OpenCode proof source/dist inputs and10 owning Codex native-proof inputs. Shell b6c096735522dd1c43f9750f/29 resources remain byte-identical. The12desktop/390 light/dark Decide/Approve/run-list,8builder and3safe-native-failure/subsequent-answer images retain their original actual inspections,360 audits, keyboard/Save/error/delayed-response identities. Four initial visible projection equalities remain historical94 evidence; no changed-backend equivalence is inferred. No new browser replay/screenshot/OS-reader execution is claimed.

[Required matrix and builder images](2026-10-22-taskbot140-views-round2.md), [desktop failure](assets/taskbot140-views/round3/ui/failure-desktop-light.png), [390 dark failure](assets/taskbot140-views/round3/ui/failure-390-dark.png), [390 dark answer](assets/taskbot140-views/round3/ui/answered-390-dark.png). Changed runtime/MCP/native delivery is excluded from reuse and freshly validated above.

Pinned OpenCode1.2.27 synthetic legacy refusal/initialized metadata/original-ID resume and Node/Bun read-only metadata proof is reused only for8 unchanged owning inputs. Codex0.163 effective-config/OS-denial proof is reused only for10 unchanged owning permission inputs, not the changed generic MCP/native dispatch modules. Current owning configuration/start/resume suites and the new controlled native-process framing tests validate the current source. No native live-model/auth quality or transitive whole-program equivalence is claimed.

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
| Native ticket replies / Taskbot comments | Exact digest-bearing /view-answer, free text cannot approve; actual post-Ask current publication, long-text guidance, Taskbot+Linear adapters, retry/restart/out-of-order, held provider reads/transcript preparation, actual downstream HTTPS initialize/capacity admission and native durable/paced retry/recovery, live child-source renewal and real asset-denial tests. Taskbot inbound ingestion stays inapplicable. |
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
| Gates/F1/UI/docs | Fresh stable-source required gates, actual F1/native/current dispatch flows, precisely bounded UI reuse, PR-linked changelog and maintained view documentation. |
| Frozen definitions/accepted answers/history/native stores | No broad rewrite; private raw historical diagnostics retained; pending safety projection renews current digest; original accepted receipt/output unchanged. |
| CI/status/merge/epic completion | Parent only, NEW independent round5 required. No acceptance/merge/main-green/release/website claim for this revised candidate. |




## Submitted archive, failures and limits

[Fresh Git-export verifier](assets/taskbot140-round5-archive-verify.mjs), [cumulative inventory](assets/taskbot140-views/round5/archive-sha256.json), [original-byte mappings](assets/taskbot140-views/round5/original-copies.json), [archive notes](assets/taskbot140-views/round5/archive-notes.md), [submitted proof](assets/taskbot140-views/round5/submitted-archive-proof.json). The verifier checks the complete tracked non-evidence input set/modes/literal bytes, retained/current drivers, all archive hashes/relative report links and original186 verifier from a fresh Git export. Literal symlinks and the non-runtime LFS pointer are checked without following/exporting private backup data. Original186 SHA3b0b2aba… and prior577/707 inventories remain pinned byte-identical. A separate exact-final-tree exported receipt avoids self-referential commit/hash claims.

[Focused original outputs](assets/taskbot140-views/round5/focused/combined-edge-seams.log), [reviewer's original HTTP-initialize negative](assets/taskbot140-views/round5/review-r4/mcp-preparation-probe.json.raw). All original rounds/source variants/stops/native/provider/UI failures remain historical. The first archive export passed837 hashes/2818 literal inputs/9drivers and failed only its not-yet-created derivative proof link; its exact failed receipt is retained, the reference was created and the complete export repeated. New pre-freeze scratch fixture failures (SDK relationship/error shape, legacy-binding fixture option, unrelated child lifecycle count, capacity hold armed too late) remain distinct original logs/receipts. Earlier dirty exploratory receipts record the then-current Git HEAD53c but are evidence neither for immutable53c nor for the final clean candidate; exact initial scratch driver versions were not archived, and are not fabricated. Final executed driver bytes and all claimed original gate/native/failure receipts are submitted with hashes. No failed/stopped run is a PASS, no timeout/assertion weakening, no paid/production/status/CI/release/later action. Parent runs a NEW independent exact-candidate review and owns CI/merge/main health.
