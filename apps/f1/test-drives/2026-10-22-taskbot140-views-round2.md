# Taskbot140 — independent round1 repairs

[PR177](https://github.com/jappyjan/bobs-factory/pull/177),
[Taskbot140](https://taskbot.apps.janjaap.de/p/bobs-factory/t/140), epic135.
Predecessor139/PR176. Retained integration owner/worktree:
`/Users/jappy/.t3/worktrees/bobs-factory/taskbot-140-views`, branch
`taskbot/140-views`; inherited T3 binding remains the coordinator checkout.
Base `fa866b3d18a880a72fb59f19bfc88195cd4db762`.

This packet records repairs to the six findings in authoritative Taskbot2197.
The immutable reviewed head246e remains in history. Parent owns a NEW independent
review and exact-head CI/merge authorization. No acceptance clearance is claimed.

## Finding responses

| Finding | Root cause and correction | Consequential regression |
| --- | --- | --- |
| R1/P2 | Root ignore rules silently omitted71 advertised original logs. Narrow archive exceptions publish their exact original bytes, without rewriting manifests or replaying historical gates. A submitted verifier exports Git into a fresh directory and checks inventories, hashes and report links. | Old246 export fails71 omissions; repaired export resolves all186 original archive entries plus nested original inventories. |
| R2/P1 | Requested allowedTools did not restrict provider native tools/config; Codex construction also replaced restrictions. A trusted runtime context-only profile enforces exact context list/read at actual provider boundaries, clears inherited sources, and fails before a turn when effective permissions cannot be established. Ask input contains only item/question/public thread/displayed view. No Snapshot prerequisite or artifact submission. Native model/session/provider ownership persists. | Production EdgeWorker config path plus actual provider query/config/permission-hook/start/resume tests. Native Codex0.163 no-model configuration/OS denial proof. No paid live model claim. |
| R3/P2 | Text omitted discussion and sliced off protocol/current decisions after long displays. A shared formatter reserves current batch/digest/answer protocol, includes bounded public discussion/status/error, prioritizes current decisions, and marks incomplete output with full-dashboard guidance. | Real runtime/API/native ticket fallback with two large Shows,13×8000-character items and Ask; exact digest rotation and reconstruction. |
| R4/P1 | Late Ask completion unconditionally published an old record. Per-run short transitions serialize admission/answer/checkpoint/result persistence. Publication requires exact active frame/current waiting batch and unchanged source/config; historical results keep original thread/native identity. In-flight IDs and colliding native execution keys are scoped to their owning batch/item. | Real controlled Launch child status change while Ask is held, stale rotation, both acceptance orderings, inverse completion and persisted reconstruction; reused request UUID across items settles both original threads. |
| R5/P2 | Match metadata belonged to an earlier request while current edits changed the preview. Exact draft/workflow signatures own loaded metadata; stale/out-of-order responses cannot install results. Current type/title/view/Decide/reads/notification config is compared with accepted config; accepted source-input provenance remains separately labelled. | Production-used request controller/renderer interactions for edit-after-load, view/action/Ask/followUp/workflow changes, delayed responses, wrong owner and explicit notification consent. Actual builder interactions are recorded below. |
| R6/P2 | Push serialized only fixed category text and the service worker discarded text. Private defaults remain unchanged. Trusted human-step notifications.push=view-text is an explicit builder choice, copied into accepted snapshot/digest and captured queued event. Bounded inert text is serialized and displayed only with its explicit envelope; old queued/private events never upgrade. | Actual FactoryPush serialized transport and bundled service worker tests cover all14 components, private/opt-in, Unicode/encoding bounds, protocol/digest, queued privacy/content, dedup/reconstruction/no replay. No live device claim. |

## Current validation identity

Production/test/driver source frozen at `66668d8fffc63fc5dfcb37c9940f123491cd4c0f`,
tree `b68e91a49d5d8c27a7dc999af152c10dad81ea4c`. The checkout was clean for
all gates, F1 and native compilation. Final documentation/archive commits preserve
these inputs; the submitted input-equivalence and fresh Git-export proofs are linked
below. Node24.21.0, pnpm10.33.1, Bun1.4.2, macOS26.6.2 ARM64; no dependency or
lockfile changes. Exact main remains the predecessor SHA above. No current website,
release, other-platform, minimum-OS, live model/auth/forge/device-push claim.

## Fresh gates and runtime evidence

| Command | Fresh result |
| --- | --- |
| `pnpm build` | Exit0. |
| `pnpm typecheck` | Exit0. |
| `pnpm lint` | Exit0:1489 files,0 errors,37 retained warnings. |
| `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm test:packages:run` | Exit0:4346 passed,3 skipped,16 packages;342 passed files and1 opt-in native file skipped (343 total). Edge2979 passed/1 skipped/230 files. |
| `VITEST_MAX_WORKERS=1 pnpm --workspace-concurrency=1 -r --filter './apps/*' test:run` | Exit0:255 CLI +41 desktop +17 F1 =313 passed,1 desktop skip. |
| `node --test --test-concurrency=2 scripts/tests/*.test.mjs` | Exit0:179 passed,0 failures/skips. Local fixtures only, no release job/publication. |
| `F1_AGENT_MODE=mock F1_EXPECTED_SOURCE_COMMIT=66668d8f… node apps/f1/test-drives/assets/taskbot140-views-repairs.mjs` | Exit0; actual details below. |
| `bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/taskbot140-round2-native-build` | Exit0, clean666 source/Bun1.4.2. |
| `BOBS_FACTORY_SMOKE_PORT=46397 bash scripts/smoke-binary.sh …/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory` | Exit0: OS-only PATH; startup/assets/protected API/scoped MCP/shutdown/restart. |
| `node apps/f1/test-drives/assets/taskbot140-views-native.mjs --binary …/bobs-factory --output /tmp/taskbot140-round2-native-view-evidence` | Exit0:26 actual responses, saved definition/preview/reconstruction, no configured project or provider. |

[Exact command/exits/timings/log hashes](assets/taskbot140-views/round2/gates/gates.json),
[all2782 input paths/modes/bytes/hashes](assets/taskbot140-views/round2/gates/source-inputs.json),
[per-package counts](assets/taskbot140-views/round2/gates/package-counts.json),
[complete original package log](assets/taskbot140-views/round2/gates/packages.log),
[native compile and wrong-path attempt](assets/taskbot140-views/round2/native/build-and-path-failure/gates.json),
[current successful native smokes](assets/taskbot140-views/round2/native/gates/gates.json).
The all-path input manifest also includes one existing non-runtime LFS run-backup ZIP. Its hydrated local bytes stayed unchanged through every gate; its133-byte Git pointer stayed unchanged from666. The final export checks2781 literal input files and4 drivers, plus the exact unchanged LFS pointer separately, without exporting its payload. It is not a build/runtime/embedded-resource input. [Explicit distinction](assets/taskbot140-views/round2/input-equivalence.json).

Every final command has the same input fingerprint
`30879a3607d0ee0b7f7a4728894a5bb3b08af164eb86a8fe21863b2f5e2e048a`.

The retained native executable is113381106 bytes, SHA256
`021385adb3b1bec5d5db90f5396267ccc916002c5868548476be513b368fef0a`,
version1.0.0-beta/darwin-arm64, resource digest
`5b6465f16a8165035ecbb5bca53e826908862495714dbd8e87ebd3dbc65dff59`.
[Unmodified build identity](assets/taskbot140-views/round2/native/build/build.json)
retains its compile-time pending-smoke field; separate successful smoke receipts
supply the validation, without rewriting original metadata. This is a local
validation binary, not a release/publication or later documentation-head binary.
[Actual26-response receipt](assets/taskbot140-views/round2/native/views/attempt-2026-10-22T07-36-32-344Z-7ad2f08a/native-views.json)
retains original responses and both worker logs.

All gates ran sequentially on frozen source; packages used ONE worker and serial
workspace scheduling. No previous consequential assertion or timeout changed.
The new OpenCode test alone uses an8s test budget to observe the unchanged5s
production metadata-process kill and asserts elapsed<7s. The opt-in native Codex
OS test is skipped by ordinary package tests and has separate no-model native
proof. Full capability-prompt expectation remains an entire-string assertion with
`.verify()`; stock frozen prompts are unchanged.

F1 applies to human waits, routing, native assistance configuration, activities and
answer channels. The actual production EdgeWorker/CLI drive uses disposable homes,
local Git and policy-controlled mocked providers. Final F1: **PASS**,
07:16:23–07:16:47 UTC,5 saved-run scenarios/13 mocked turns/32 protected requests/
9 CLI activities, zero paid calls. It retains original accepted payloads/digests,
source/build/driver identities, native Ask IDs/models, requests/comments/actions,
real persisted reconstructions and actual compiled terminal frame.

- Source `66668d8f`; executed driver SHA256
  `afc73532bad8706e7fa303bf71eb810a294d1387e61a73985f7fb35f2e3d2834`.
- Local measured whole-dist aggregate
  `217aaa924c6a6b44d12226af861cc306590290982a7d8e843079a877c3523f58`;
  this identifies this drive's files, without claiming independent reproducibility.
- Backend source-manifest SHA256
  `9738c656923930e3d3ea9c00671944df8914092668669b5b664fade858ffcad0`.
- Dashboard shell `b6c096735522dd1c43f9750f`; exact resource identities in receipts.
- Original three composed/alternate/wave scenarios remain. Added actual held Ask
  restart with production Codex config,13 long items/two Shows/current Ask text and
  terminal/ticket protocol, accepted trusted opt-in event, and actual child completion
  rotatingA→B before lateA finishes. B remains answerable after reconstruction;
  A retains historical native/result ownership and cannot be accepted.

Current raw F1: [results](assets/taskbot140-views/round2/f1/final/results.json),
[scenario receipts](assets/taskbot140-views/round2/f1/final/scenario-results.json),
[HTTP requests](assets/taskbot140-views/round2/f1/final/http-receipts.json),
[actual runner config capture](assets/taskbot140-views/round2/f1/final/native-config-captures.json),
[mocked invocations](assets/taskbot140-views/round2/f1/final/mock-invocations.json),
[activities](assets/taskbot140-views/round2/f1/final/activities.json),
[terminal frame](assets/taskbot140-views/round2/f1/final/terminal-current-view.txt),
[complete stdout/stderr](assets/taskbot140-views/round2/f1/driver.log.txt).
Other original actions/comments/push/source/executed-driver files are beside them.

## Enforced Ask provider boundary (R2)

| Boundary | Actual verification and limits |
| --- | --- |
| EdgeWorker admission/creation | Actual `executeFactoryAgent` path and managed/native constructor configuration; only item/question/public thread/displayedView, exact context list/read tools, private assistance cwd, no Snapshot prerequisite/artifact/docs MCP/write directories. Persisted provider/model/session/profile restored. Unsupported profile refuses without replacing the native conversation. |
| Codex | Actual config builder→runner/backend→app-server start/resume/turn; effective config and MCP tools checked before turns, unexpected approvals/tools/elicitation denied, process-pool profiles isolated. Dedicated filesystem permission profile denies root/workspace/tmp writes and network; shell disabled, native patch effects denied by OS. Native Codex0.163.0 no-model/no-thread-start proof checks accepted config, unexpected inherited MCP detection, OS denial of outside reads/writes, cwd writes and loopback network, with an unsandboxed positive control. All23 proof inputs match final source byte-for-byte. |
| Claude | Actual SDK query options and permission callbacks: no native tools, skills/plugins/settings/config MCP discovery, hooks, extra directories or fallback; strict only scoped context MCP. `canUseTool` and PreToolUse both deny all other requests, including resumed history. Unknown mandatory managed sources refuse; native session/model retained. No live SDK/model request. |
| Cursor | Actual SDK options plus installed factory-owned permission-hook subprocesses deny filesystem/shell/delegation/web/other MCP/artifact requests; only exact two context tools. New/resumed transport/config tested; inherited startup/enterprise/Claude-hook sources refuse before a turn. No prepared live Cursor/auth session. |
| OpenCode | Actual spawned CLI env/config: wildcard deny plus exact two context tools, only primary agent, isolated config/home/working discovery while preserving original native data/auth store. Read-only bounded5s/16KiB metadata CLI probes reject old/broad/unattested sessions, remote well-known auth config, active organization config and unknown/unparseable metadata before turns. Auth types/counts and permission booleans only; no token/history read/copy/log. Provider metadata fetching disabled. Mocked CLI metadata/config tests, not a live paid agent. |
| Gemini | No enforceable context-only implementation is claimed; generic Ask refuses before a Gemini turn rather than granting workspace powers. Existing ordinary Gemini behavior stays unchanged. |

[Original actual broad native-config repro at246](assets/taskbot140-views/round2/raw/taskbot140-review-r1/actual-ask-config.json),
[Codex96-test focused output](assets/taskbot140-views/round2/raw/taskbot140-codex-context-regressions-final-4.log.txt),
[actual no-model native configuration/OS receipt](assets/taskbot140-views/round2/raw/taskbot140-codex-context-native-final-3/receipt.json),
[exact23-input/native-binary reuse proof](assets/taskbot140-views/round2/native/codex-input-equivalence.json),
[Claude focused output](assets/taskbot140-views/round2/raw/taskbot140-claude-unknown-model-pass.log.txt),
[Cursor focused output](assets/taskbot140-views/round2/raw/taskbot140-cursor-context-final.log.txt),
[final OpenCode metadata52-test output](assets/taskbot140-views/round2/stabilization/taskbot140-opencode-remote-metadata-final.log.txt).
The full current package gate above also exercises every current provider regression.
[R6 serialized payload/bundled worker23-test receipt](assets/taskbot140-views/round2/raw/taskbot140-r6-push/receipt.json)
and the current full suite cover actual production serialization with mock transport only.

## Changed UI and precisely scoped image reuse

Actual product-native T3 preview used saved recipes, real production renderer/runtime
and HTTP endpoints in a disposable local fixture; no patched state gallery. Executed
UI driver SHA256`192692a1c243115ebaa12b3008c0d0372e88071839f58c913d259777ddb8f0b2`.
[Identity](assets/taskbot140-views/round2/ui/identity.json),
[raw browser interaction receipts](assets/taskbot140-views/round2/ui/browser-receipts.json.raw),
[real saved API readback](assets/taskbot140-views/round2/ui/runtime-readback.json.raw),
[every original screenshot/receipt/log hash](assets/taskbot140-views/round2/ui/evidence-manifest.json.raw),
[precise static-image input/projection equivalence](assets/taskbot140-views/round2/ui/static-screenshot-reuse.json.raw),
[root actual image inspection](assets/taskbot140-views/round2/ui/root-visual-inspection.json).

Real loaded view/action/Ask/followUp/title/workflow/type edits withdraw prior match;
held and out-of-order HTTP responses cannot reinstall obsolete provenance. Explicit
consent starts unchecked, Space/focus works, Save200/export/reload retains the choice
without human agent fields, and old accepted-run inputs show a mismatch. Invalid JSON
has aria-invalid/associated error and disabled Save. Both360px themes have document,
body and panel width360; controls labelled, no malicious DOM/unsafe links/attack
resource requests. The expected screen-reader-only legend uses its hidden1px box.
Fixture and own preview tab shut down cleanly. No OS screen-reader session claimed.

| Current builder state | Desktop light | Desktop dark |390px light |390px dark |
| --- | --- | --- | --- | --- |
| Explicit consent | [PNG](assets/taskbot140-views/round2/ui/builder-desktop-light-consent.png) | [PNG](assets/taskbot140-views/round2/ui/builder-desktop-dark-consent.png) | [PNG](assets/taskbot140-views/round2/ui/builder-390px-light-consent.png) | [PNG](assets/taskbot140-views/round2/ui/builder-390px-dark-consent.png) |
| Retained-input preview | [PNG](assets/taskbot140-views/round2/ui/builder-desktop-light-preview.png) | [PNG](assets/taskbot140-views/round2/ui/builder-desktop-dark-preview.png) | [PNG](assets/taskbot140-views/round2/ui/builder-390px-light-preview.png) | [PNG](assets/taskbot140-views/round2/ui/builder-390px-dark-preview.png) |

The original12 Decide/Approve/run-list desktop/390px × light/dark PNGs remain
actual authenticated screenshots, linked in the original packet. Their renderer,
styles and layout inputs are unchanged; the new visible-projection comparison
normalizes only generated batch/digest/time/child identities. This reuse validates
those visual states only. Changed builder, backend, approval/Ask ownership and push
behavior use current evidence above; no old backend pass is relabelled.

## Every scope and acceptance row

| Requirement | Current implementation verification |
| --- | --- |
| Declarative schema/list; literal/JSON-pointer bindings; save/render validation | Shared strict bounded view-v1 validation on save, library agent output, runtime, API and renderer. Unknown component/data/pointer/descriptor/prototype/accessor/toJSON rejected without invocation. |
| Scope/discovery/lexical Call/For each | Only declared accepted `/inputs` plus lexical item/index; explicit mappings, no arbitrary runtime/evidence path traversal. Current full foundation suites and composed F1 cover positive/negative ownership; blocking concurrent human steps retain single-owner prohibition, Show works in loops/Calls. |
| Agent-emitted view format | Current F1 genuine mocked agent result resolves library view-v1, including empty screenshots; display text cannot opt in to permissions, notifications or native approval. |
| markdown | Inert Markdown/HTML/remote-image fallback; useful escaped text. |
| checklist | Label/state/detail renderer; checked/partial/open text. |
| before/after | Labelled paired renderer and text sections. |
| chart | Numeric bar/line values/series renderer and textual values. |
| screenshots | Same-run protected verified inventory/image/hash; alt/caption/hash text, empty selection no producer; retained real-file pre-read size/mutation/foreign-path negatives in current suite. |
| video | Existing protected verified inventory/revision/hash plus transcript; corresponding text. No live video/OS accessibility claim. |
| table | Native headers/scalar cells, bounded wrapper; useful row/header text. |
| code reference | Bounded relative reference/lines/inert excerpt, same text; no arbitrary fetch or execution. |
| steps | Ordered statuses/details and numbered text. |
| points | Labels/details and credential-free HTTP(S) click links, numbered text. |
| item cards/actions/comments/details/Ask | Recipe-owned stable IDs/action/comment/detail controls, dedicated persisted Ask with enforced profile. R2/R3/R4 regression coverage covers malicious requests, faithful discussion and historical/current ownership. No source research rerun/Improve migration. |
| choices/form | Labelled native fields/options/required values and accepted values; meaningful fallback. |
| run list | Real Launch child wave/status/public navigation projection; real child completion drives F1 race. |
| sticky decision bar | Explicit sticky mobile controls/confirmation, recipe action labels; text summary/actions. |
| Decide outputs/routes | `choices`, `itemsByAction`, `followUps`, `hasFollowUps`, optional comments/forms. Actual F1 takes follow-up and alternate route; no agent-provided action authority. |
| Approve/Request changes | Exact server content/config/thread/assets/batch digest and explicit accepted:true; stale/changed data rejected, feedback required for changes. Existing native/frozen/recovery authority separate. Current F1 and full runtime/API suites preserve original accepted payloads/retries/conflicts. |
| Show | Nonblocking progression, bounded persisted display, no long-lived lease/decision push; Call/For each positive composition and current text prioritization tested. |
| Dashboard/API | Shared exact answer validation; concurrent/idempotent/stale results and reconstruction tested. Late historical Ask cannot republish over active/terminal batch. |
| Terminal | Actual compiled TodayApp frame contains exact current batch/digest/protocol and Ask before long body; bounded INCOMPLETE/full-display guidance. Native `/view-answer` command uses same explicit validator. |
| Ticket replies/comments | Actual EdgeWorker/CLI/F1 ticket path exercises explicit command/rejection/acceptance; ordinary free text grants no approval. Taskbot outbound fallback is supported, no inbound Taskbot ingestion exists. |
| Push | Private default/old queued privacy preserved. Trusted accepted opt-in delivers bounded component/discussion text with exact current identity/protocol; actual serialized transport/bundled worker tests across all14 components, dedup/retry/reconstruction/no replay; no live push effect. |
| Restart/history/native ownership | Saved waits/exact answers/native Ask session/model/profile retain identity. Current real held Ask+child rotation and multiple persistence orderings preserve B while settling historicalA; duplicate request UUID across items cannot lose a thread. |
| Every plain-text fallback | All14 component functions, aggregate API/terminal/ticket Ask/current/bounds and opt-in push serialized payloads tested; truncated text explicitly directs to complete dashboard before acceptance. |
| Builder schema/errors/Save | Current actual invalid/valid Save plus API GET→PATCH real editable projection; no human agent authority fields, invalid Save disabled, clear errors. |
| Available-path autocomplete | Bounded accepted scope discovery and actual insertion; no private arbitrary run preview. |
| Sample/last-run preview | Sample/live accepted input snapshot; exact full step/workflow request ownership and late-response guards. Current edited config mismatch distinguished from accepted source-input provenance; actual delayed/edit/save interactions. |
| 360px/light/dark/keyboard | Current changed-builder keyboard/theme/overflow receipts and precisely unchanged12 original screen matrix. Semantic labels/groups/radios/statuses/table/focus retained; no actual OS screen-reader session claimed. |
| Component/fallback/malicious tests | Current entire packages suite includes consequential components, inert strings/URLs/getters/prototypes, actual permissions, Ask concurrency, preview and push payload tests. |
| Decide/Approve E2E | Current actual mocked EdgeWorker/CLI saved recipes/ordinary routes/stale digest/restart plus held child race; zero paid/native merge approvals. |
| Full suite | Current required gates above; historical failed/stopped runs below remain failures/stops. |
| Documentation/prompt/changelog | Maintained views docs, privacy exception, PRODUCT_CONTRACTS, PR177-linked changelog and entire capability expected prompt. |
| Epic135 scope/compatibility | No step-name magic/hidden model prerequisite; frozen definitions, original outputs/native sessions/pending obligations and136–139 receipts preserved. Improve deletion141, subrecipes142, human-screen migration143 and144–148 remain deferred. Parent owns NEW independent acceptance/CI/merge, with epic open. |

## Original failures, archive publication and final-input proof

Original source667/246 full gate/F1/native/backend evidence stays historical. Its
whole-dist aggregate09c4f770… was not independently reproduced (reviewer62818161…)
despite matching1377 inputs/29 resources/8 critical compiled files. This limitation
is retained; the new measured aggregate identifies only this current build.

[Original186-entry submitted archive proof](assets/taskbot140-views/r1-fix/receipt.json),
[103 exact focused/reviewer/provider originals](assets/taskbot140-views/round2/focused-originals.json),
[36 exact stabilization/stopped-gate originals](assets/taskbot140-views/round2/stabilization-originals.json),
[current final outputs and retained failed F1 originals](assets/taskbot140-views/round2/current-originals.json),
[final archive inventory](assets/taskbot140-views/round2/archive-sha256.json),
[fresh submitted Git-export verification](assets/taskbot140-views/round2/submitted-archive-proof.json),
[final validated-input/mode/path equivalence](assets/taskbot140-views/round2/input-equivalence.json).

Fresh submitted-index export passed440 archive byte hashes,2781 literal input files,4 exact drivers,1 unchanged non-runtime LFS pointer and93 relative report links; original nested checks include186 archive entries/58 raw mappings/18 native hashes/54 UI rows. Its tree identifies the index before installing its own excluded result file; final committed HEAD is verified again and reported on the ticket.

Run the submitted verifiers from any checkout:
`node apps/f1/test-drives/assets/taskbot140-archive-verify.mjs --tree HEAD`
and `node apps/f1/test-drives/assets/taskbot140-round2-archive-verify.mjs --tree HEAD`.
They export Git bytes into fresh directories; no retained/tmp file is required for
archive hashes/links. Local original-file comparisons are additional checks only.

| Retained failure/stop | Qualification |
| --- | --- |
| Originale4e9/667 broad failure/stops and native attempts | Original bytes, exits/partial output and earlier report retained; never relabelled as passes. CheckImpactRetention contention remains inference; original assertion/15000ms timeout unchanged. |
| First outside gate manifest setup | Directory-symlink EISDIR before any gate. Original harness source retained in stabilization; the unredirected tool response remains in conversation, no fabricated raw stdout file. Reader now hashes mode120000 link targets. |
| Frozen2b6b F1 | [Exact failed log](assets/taskbot140-views/round2/stabilization/taskbot140-round2-validation/f1.log), [actual failed raw receipts](assets/taskbot140-views/round2/f1/attempt1/scenario-results.json). New driver wrongly compared a pending native checkpoint with a completed result; corrected to preserve exact original identity/profile and separately verify result/revision, including complete post-restart checkpoint. No product assertion waiver. Packages/apps/scripts never started on that stopped sequence. |
| Frozen2b6b real builder Save400 | [Original receipt](assets/taskbot140-views/ui/repairs/browser-receipts-before-save-fix.json.raw), [inspected screenshot](assets/taskbot140-views/ui/repairs/save-failure-before-fix.png). Corrected human editable projection; strict schema remains, current actual Save200 passes. |
| Current native wrapper path | [Exact exit1 output](assets/taskbot140-views/round2/native/build-and-path-failure/native-standard-smoke.log): owning package0.2.73 was mistakenly used instead of CLI1.0.0-beta. Failed before startup. Corrected outside wrapper smokes the same successful binary; no rebuild/relabel/source edit. |
| Publication verifier setup | [Exact attempted code/stdout and truthful tool-channel failure audit](assets/taskbot140-views/round2/publication-attempts/failure-audit.json). Per-file proof exposed the existing LFS pointer/hydrated distinction; whole-export buffer exceeded256MiB. The corrected disk export and named non-runtime pointer proof change evidence tooling only; no gate result is relabelled and no product input changes. |
| Provider/new focused RED/fixture iterations | Exact logs/manifests above retain failures distinctly. Production OpenCode metadata deadline remains5s; new observation test budget alone8s. Native Codex initial config/mapping attempts remain separate from its final no-model OS proof. |

Pre-existing tests: only the entire capability-reference expected prompt changed.
No original assertion/timeout/security outcome was deleted or weakened. New tests
that first failed due to their own fixture/projection assumptions are retained,
with narrow corrections and raw output; stopped/failed gates are never passes.
