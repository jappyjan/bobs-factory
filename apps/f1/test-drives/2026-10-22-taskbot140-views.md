# Taskbot #140: declarative views and human steps

Date: 2026-10-22. [Ticket](https://taskbot.apps.janjaap.de/p/bobs-factory/t/140),
[epic #135](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135), predecessor
[#139 / PR #176](https://github.com/jappyjan/bobs-factory/pull/176).

## Scope and identity

This validates saved custom recipes using the production `decide`, `approve` and
`show` blocks, their declarative renderer, editor, answer channels and immutable
human receipts. Existing Questions, Check-in, Human review, External review and
Improve remain on their existing implementations. No production run, live tracker,
paid model, remote merge, release publication or deployment was used.

- Retained checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-140-views`.
- Branch: `taskbot/140-views`; inherited T3 app binding still points at the
  coordinator checkout. All implementation commands used the retained path.
- Fresh fetched base: `fa866b3d18a880a72fb59f19bfc88195cd4db762`, tree
  `71aa76489a5e1fa6406d608b921e3500b05056ae`. Exact push-main CI `39720910459`
  was confirmed successful before implementation. Website was path-filtered.
- Final production source: `667cbffd00357b2d192239f89c33d300c70a0c8e`, tree
  `5f7e9fe8b16a62da25d99a155965bac9a3fdaa44`.
- Node `24.21.0`, pnpm `10.33.1`, Bun `1.4.2`, macOS `26.6.2` ARM64. No dependency,
  lockfile, upstream attribution or credential-store changes.
- Production browser shell: `build-32c73ab9807a3c6248b0d42f`.
- Final mocked F1 backend build SHA-256:
  `09c4f7707178a57063f2bc4fd7f91dc83d97812ead7f0ac8fa7363e355344b2a`;
  backend source manifest SHA-256:
  `f387514c1f72a612180661fd9468d14767bfa5fb98efd6c709ad8fedd73293ac`.

## Contracts and implementation choices

The pre-replacement audit and decisions are recorded in ticket comments
2170–2172; the media/read-boundary correction and stopped historical gate are in
2173–2174. The maintained usage reference is [Declarative recipe views](../../../docs/factory/views.md).

| Contract | Implemented boundary and evidence |
| --- | --- |
| Envelope and validation | Strict bounded `view-v1`, 14 components, unique component IDs, literal or RFC 6901 JSON-pointer data. Shared schemas validate recipe save, agent output, runtime resolution, API, renderer and text fallback. Unknown fields/types, wrong data and malformed pointers fail clearly. |
| Scope and discovery | Only declared unconditional `/inputs` plus lexical `/item` and `/index`; no arbitrary run paths. Descriptor-safe reads reject prototype keys, getters, `toJSON`, symbols, cycles and non-JSON values without invoking them. 1 MiB/depth32 scope, 40 components, bounded item/wave/child counts and bounded path discovery. |
| Call / For each | Explicit mappings and accepted frozen definitions supply the lexical scope. Sequential Call preserves human waits through reconstruction. Completed Call/For each results can feed views; Show executes within their lexical frames. Blocking Decide/Approve are rejected transitively inside For each/Parallel, including calls, rather than creating ambiguous concurrent answer ownership. |
| Item authority | Stable safe item IDs and action/comment/detail/Ask configuration belong to the accepted recipe. Agent-provided display labels, action-looking strings, links or approval objects grant no authority. Decide returns `choices`, `itemsByAction`, `followUps`, `hasFollowUps`, `fields` and original batch/digest; normal branches consume these. |
| Inline Ask | A dedicated retained agent/thread sees bounded supplied context through context-list/read tools only. It inherits the model unless explicitly configured, never reruns source research and carries no filesystem tools. This context-only explanation protocol avoids introducing a hidden Snapshot prerequisite. Follow-up routing is separate from discussion. |
| Exact approval | Server snapshot and digest include displayed data, title, configuration, actions/forms, thread history and run/frame/batch identity. Runtime re-resolves and verifies assets before acceptance and rechecks after asynchronous work. Explicit `accepted:true` and the current digest are required; stale data/assets/config/batches, arbitrary digests and request changes without feedback fail. This cannot authorize native recovery, publication or merge. |
| Persistence / concurrency | Snapshot, scope, accepted answer and Ask session/history persist separately from old pending answers. Exact retries return the original result; conflicting/concurrent submissions cannot overwrite it. Interrupted Ask resumes its own native identity and cancelled late output is ignored. Original accepted payloads/history/capture inventory remain intact. |
| Channels / notifications | Dashboard and protected API use the same validator. Terminal and native ticket replies use explicit `/view-answer` JSON with current batch/digest. Ordinary replies and operate-scoped MCP cannot approve. Existing Taskbot integration publishes fallback comments but has no inbound reply channel. New-decision push identity is batch/digest; persisted at-most-once claims avoid restart duplicates. Show emits no human-decision push. |
| Nonblocking Show | Saves a bounded display, advances immediately, publishes fallback asynchronously and holds no long-lived execution lease. |
| Media, code and links | Current-run authenticated capture inventory, bounded same-run evidence paths, actual image signature/hash and pre-read size guard. Video uses the existing validated inventory and repository revision. No arbitrary file reads or remote media. Code references/excerpts stay inert; credential-free HTTP(S) links only. |
| Editor / provenance | Shared JSON schema and errors, invalid Save disabled, available-path datalist, local sample preview and last-run accepted bound-input snapshot with run/step/time/definition-match labels. Preview cannot approve or launch agents. |

## Acceptance and component matrix

| Ticket criterion | Consequential verification |
| --- | --- |
| Component tests and text fallbacks | `View.test.ts` (67), `DeclarativeView.test.ts` (15), `FactoryViewIntegration.test.tsx` (6) cover all component output, forms, read-only accepted values, safe Markdown/media and invalid Save. Terminal projection has its own CLI test. |
| Decide/Approve choices, stale content, restart | `HumanViewsRuntime.test.ts` (18), `HumanViewsApi.test.ts` (4), plus actual EdgeWorker/CLI F1 below. Includes content/config/assets, exact retry, concurrent competing answers, unknown items/actions/comments, Request changes, actual persisted reconstruction, sequential Call, lexical For each Show and private read denial. |
| Malicious view / agent output inert | Schema/runtime/renderer tests exercise script/HTML/Markdown/control strings, unsafe URLs/media/pointers, getters and `toJSON` without execution. Browser verifies no active malicious DOM or remote resource load. Agent-emitted view-v1 is exercised in actual mocked F1. |
| Desktop / 390px light and dark screenshots | All 12 required current-source images linked below, with original identities and hashes. |
| 360px and accessibility | Both themes, all three pages: settled `scrollWidth == clientWidth == 360`, no overflowing elements. Actual keyboard radio navigation, visible focus, labelled comment fields, native form controls, explicit confirmation and semantic groups/statuses inspected. No OS screen-reader session is claimed. |
| Full suite | **PASS**:4,257 package tests/335 files,313 app tests and179 script tests; three total skips, zero failures in final gates. Original logs and command receipts below. No existing consequential outcome or timeout was weakened. |

| Component | Rendered behavior and meaningful text fallback |
| --- | --- |
| markdown | Safe Markdown text; HTML omitted, remote image becomes a text label. |
| checklist | Label, state and optional detail; `[x]`, `[-]` or `[ ]` fallback. |
| beforeAfter | Labelled before/after panes and note; corresponding plain-text sections. |
| chart | Numeric bar/line chart with labelled values; every series/value listed in text. |
| screenshots | Current-run protected images with alt/caption; index, caption and content hash in text. Empty selection works without a capture producer. |
| video | Protected verified recording and visible transcript; label, hash and transcript in text. |
| table | Native table and bounded overflow wrapper; headers and scalar rows in text. |
| code reference | Relative file/lines plus inert excerpt; same reference and excerpt in text. |
| steps | Ordered stage track/status/detail; numbered text steps. |
| points | Label/detail and validated links; numbered plain-text points. |
| item cards | Recipe-owned action radios, optional per-action comments, expandable details and inline Ask; item/action/detail/thread text plus explicit answer protocol. |
| choices/form | Labelled text/textarea/select/checkbox controls, required-value validation; field labels, options and existing values in text. |
| run list | Launch child waves, links and statuses through the generic public projection; wave/child/status/note in text, no private prompt/execution paths. |
| decision bar | Sticky mobile controls and explicit acceptance; summary/action labels in text. Display-only action labels remain inert. |

## Actual EdgeWorker / CLI F1

Applicable because this changes recipe routing, human waits, agent assistance,
ticket activity and answer protocols. Uses canonical `f1AgentHandlers("mock", …)`
with isolated homes/local Git and mock tracker/provider controls, not live agents.

Command: `node apps/f1/test-drives/assets/taskbot140-views.mjs`.
Final result: **PASS**, 2026-10-22 05:07:32–05:07:49 UTC; 3 scenarios,
9 mocked turns, 17 protected HTTP requests, 8 CLI activities, 2 real persisted
runtime reconstructions, zero paid calls. Source/build/driver hashes stayed
unchanged before/after. Final driver SHA-256:
`89cb26596a2233df5c430181120d81216621df252ad647c72114e2cd304077d2`.

1. **Composed Decide → Ask → follow-up route → Approve:** saved custom recipe,
   ordinary Call/For each composition, agent-authored view including empty
   screenshots, exact item choices/comments/forms, separate Ask invocation, no
   source-agent rerun, real restart, one notification for the restored batch,
   source-change/stale-batch rejection, exact renewed approval and normal Show
   continuation. Original payload and digest remain in the receipt.
2. **No follow-ups → Request changes:** normal alternate route retains exact
   `approved:false` feedback; it does not imply any native approval.
3. **Actual Launch child waves:** generic projection shows running/queued waves,
   dependent child is not launched early, Show continues and the controlled run
   is explicitly stopped.

Original evidence: [results](assets/taskbot140-views/f1/final/results.json),
[identity](assets/taskbot140-views/f1/final/identity.json),
[actions](assets/taskbot140-views/f1/final/actions.jsonl.txt),
[mock invocations](assets/taskbot140-views/f1/final/mock-invocations.json),
[push events](assets/taskbot140-views/f1/final/push-events.json),
[activities](assets/taskbot140-views/f1/final/activities.json),
[raw SHA inventory](assets/taskbot140-views/f1/final/sha256.json).
All three original comment payloads, complete stdout/stderr and the executed
driver bytes are beside these receipts. This proves controlled orchestration;
it does not prove native model/authentication, live push delivery or forge quality.

## Local gates and native binary

[Complete command results and per-package counts](assets/taskbot140-views/gates/command-results.json),
[original raw log inventory](assets/taskbot140-views/gates/raw-log-manifest.json),
[complete final package output](assets/taskbot140-views/gates/logs/packages-serial-final.log.txt).

Production source stayed frozen throughout these gates. The normal source3 commit
hook ran complete `pnpm build` and `pnpm typecheck`, both exit0. Later commits
contain only documentation, validated drive fixtures and archived evidence;
production and embedded-resource input equivalence is independently recorded.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit0; no manifest/lockfile changes. |
| `pnpm build` | Exit0, complete workspace build on final production bytes. |
| `pnpm typecheck` | Exit0, complete workspace check on final production bytes. |
| `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm test:packages:run` | Exit0: **4,257 passed, two skipped,335 files** across16 packages; edge-worker2,933 passed/one skipped across227 files. Original impact-retention assertions/timeouts unchanged. |
| `pnpm lint` | Exit0: 1,476 files, zero errors, 37 warnings retained; immutable archive receipts use the same archive-only Biome policy as #139. |
| `VITEST_MAX_WORKERS=2 pnpm --workspace-concurrency=1 -r --filter './apps/*' test:run` | Exit0: CLI 255, desktop 41, F1 harness 17 passed; one existing desktop skip. |
| `node --test --test-concurrency=2 scripts/tests/*.test.mjs` | Exit0: 179 passed, zero failed/skipped; installation/distribution/evidence safeguards included. |
| `bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/taskbot140-views-native-667cbffd` | Exit0; local development binary, no release candidate/publication. |
| `./scripts/smoke-binary.sh /tmp/taskbot140-views-native-667cbffd/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory` | Exit0: two isolated startups, identity, shell/assets, protected local/foreign/public API boundaries, scoped MCP, shutdown/restart. |

Native executable SHA-256:
`f339509e52e4c4ddfee0ed4088f8fb4188dd0b00b9c83e88d85271d295a3fd82`,
113265522 bytes; embedded resource digest
`3107421db253d284c9749e79fd8d9e4cada0481153ba42a4069079df8ec68495`.
Runtime `/version` and `/api/version` matched adjacent build metadata exactly:
version `1.0.0-beta`, source `667cbffd`, target `darwin-arm64`, Bun `1.4.2`, `dirty:true`.
The dirty flag honestly reflects uncommitted evidence/drive/documentation, not a
clean release claim. All 1,377 tracked production/gate inputs match the frozen Git
blobs; recomputing every embedded resource produces the same resource digest.
See [production inputs](assets/taskbot140-views/gates/production-inputs.json).

Additional native command:
`node apps/f1/test-drives/assets/taskbot140-views-native.mjs --binary /tmp/taskbot140-views-native-667cbffd/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory --output apps/f1/test-drives/assets/taskbot140-views/native`.
Final attempt3 exit0 verifies the embedded schema, saves a custom generic
Decide→Approve→Show recipe, rejects unsafe pointers/config/agent authority,
previews sample data and compares complete saved recipe projections across two
real binary startups. It creates zero runs and executes zero providers. Full
workflow progression is covered by the separate mocked EdgeWorker/CLI drive.
It retained 26 API responses, including 8 expected client rejections, and two
graceful stops. [Final native receipt](assets/taskbot140-views/native/attempt-2026-10-22T05-24-06-431Z-9a5134f8/native-views.json),
[commands and exact driver identities](assets/taskbot140-views/native/command-results.json),
[native hashes](assets/taskbot140-views/native/SHA256SUMS),
[native scope and limits](assets/taskbot140-views/native/README.md).
The final native receipt SHA-256 is
`7f4871c90c6d7bf7925c6214326917199e7916d5696966c3c83c52206564f790`.

Native attempts1 and2 are retained failures of the driver: repositories are in
the settings projection rather than recipes, and raw PATCH definitions differ
from normalized GET definitions. The final driver preserves the zero-repository
assertion and compares the entire same projection immediately before shutdown
and after restart. No product behavior or security assertion changed.

## Current screenshots

Actual production renderer/runtime through the T3 collaborative browser, not a
patched-state component gallery. All images were recaptured on shell
`32c73ab9807a3c6248b0d42f` after the Ask draft fix. Prior images remain historical.

| Screen | Desktop light | Desktop dark | 390px light | 390px dark |
| --- | --- | --- | --- | --- |
| Decide | [PNG](assets/taskbot140-views/ui/final/decide-desktop-light.png) | [PNG](assets/taskbot140-views/ui/final/decide-desktop-dark.png) | [PNG](assets/taskbot140-views/ui/final/decide-390px-light.png) | [PNG](assets/taskbot140-views/ui/final/decide-390px-dark.png) |
| Approve | [PNG](assets/taskbot140-views/ui/final/approve-desktop-light.png) | [PNG](assets/taskbot140-views/ui/final/approve-desktop-dark.png) | [PNG](assets/taskbot140-views/ui/final/approve-390px-light.png) | [PNG](assets/taskbot140-views/ui/final/approve-390px-dark.png) |
| Run list | [PNG](assets/taskbot140-views/ui/final/run-list-desktop-light.png) | [PNG](assets/taskbot140-views/ui/final/run-list-desktop-dark.png) | [PNG](assets/taskbot140-views/ui/final/run-list-390px-light.png) | [PNG](assets/taskbot140-views/ui/final/run-list-390px-dark.png) |

Desktop CSS viewport1440×1000; T3 saved1280×889 PNGs. Mobile CSS viewport390×980,
saved780×1960 PNGs. These are screenshot scaling, not different CSS breakpoints.
All 12 images, Ask before/after and builder error/provenance images were inspected.
The isolated UI fixture and preview were stopped after verification.

- [Final 12-assertion verification log](assets/taskbot140-views/ui/final/verification.log),
  [exact accepted API payloads and retries](assets/taskbot140-views/ui/final/verification.json.raw).
- [Settled 360px audit](assets/taskbot140-views/ui/final/360-accessibility-audit-settled.json.raw),
  [Ask and keyboard interaction](assets/taskbot140-views/ui/final/ask-keyboard-interaction.json.raw),
  [negative API interactions](assets/taskbot140-views/ui/final/negative-api-interaction.json.raw).
- [Builder sample / last-run interaction](assets/taskbot140-views/ui/final/builder-interaction.json.raw),
  [path insertion and invalid Save](assets/taskbot140-views/ui/final/builder-path-and-errors.json.raw),
  [builder error PNG](assets/taskbot140-views/ui/final/builder-invalid-save.png),
  [provenance PNG](assets/taskbot140-views/ui/final/builder-last-run-provenance.png).
- [Raw image/evidence hashes](assets/taskbot140-views/ui/final/evidence-manifest.json.raw),
  [archive and cleanup hashes](assets/taskbot140-views/ui/final/archive-manifest.json.raw).

Verification log SHA-256:
`82e17e1cc77242bfedccb8334e205f2afca6553c53fc719b91e6c97071df9417`.
Executed UI driver SHA-256:
`526cba68f5a272b6dd562a9287e53fb3667342e807ce4817ac244b862389eb6f`.
The separately retained observer checks the actual original execution; the
reusable driver-only notification annotation correction is described below.

## Preserved failures and existing-test rationale

- The old `e4e9fe2c` broad package run was superseded when real media-boundary
  defects were confirmed. It received SIGINT, **exit130**, and all five original
  runner/worker PIDs were confirmed stopped before source changes. Its complete
  partial log SHA-256 is
  `c2297afcf67be11555820bded977d1344a64d88beb802cb472766d7ee4095970`.
  Partial summaries are not a passing gate.
- The first `667cbffd` broad gate reported the existing second
  `CheckImpactRetention` regression failing after 17.176s. It was stopped before
  further work, exit130; all six original PIDs were confirmed stopped. Partial
  log SHA-256 `b475efac5350700550ad620bb2f16c90fffd5edf35309059da2c0e33a5411e26`.
  Both original tests passed in isolation unchanged (12.216s/12.813s). This is
  consistent with contention around the existing 15s wait; stopping the run means
  its final assertion stack was not produced, so that cause is an inference.
  No production/test/assertion/timeout change was made. Final full validation
  uses one worker to reduce contention. Both results remain separately retained.
- Empty screenshots previously tried to parse absent capture output. A real Show
  regression now proves the no-capture case. A sparse 10 MiB+1 PNG fixture proves
  rejection before any eager full-file read; real valid bytes, in-place mutation,
  unknown index/hash and foreign-run path negatives share the protected API reader.
  Original capture outputs/history stay unchanged. Five asset tests pass.
- Early new API fixtures lacked built web resources, an actual request header and
  an assertion inside `vi.waitFor`; they were corrected without changing production
  authority. An early CLI test needed built workspace dependencies. New asset
  fixture component identity mismatch was corrected to the actual accepted ID.
- F1 attempt1 omitted `X-Factory-Request` (403); attempt2 compared null-prototype
  immutable JSON to ordinary literal prototypes. The driver now compares complete
  JSON values where JSON equality is intended. No production identity assertion
  was weakened. Both complete failed attempts and the superseded pre-media pass
  remain separate.
- UI attempt1 exposed list/radio spacing; attempt2 exposed an outer digest-key
  remount that discarded Ask drafts. Current run+batch identity retains drafts
  while changed content clears explicit confirmation. Original findings/screens
  are retained, not relabelled. A UI driver-only notification annotation was also
  corrected: the callback exposes current run/text, so Show cannot be identified
  as a duplicate decision merely by the run's previous decision ID. Exact notice
  text plus run ID is verified separately, preserving executed driver bytes.
- Preliminary format/type/new-test and generated-evidence JSON lint failures are
  retained separately. Archived JSON remains byte-identical with its original hashes. The archive-only
  Biome policy matches #139 and prevents rewriting receipts; executable drivers
  remain outside that folder and pass normal syntax/lint checks.
- The **only modified existing test** is the full expected capability prompt in
  `prompt-assembly.routing-context.test.ts`, required by the new user-visible
  workflow instructions. It still asserts the entire prompt through `.verify()`.
  No previous security, frozen-run, approval, quality or native-session test was
  removed or weakened; no timeout increase was used.

## Limits and follow-up ownership

Blocking decisions in concurrent bodies are deliberately rejected; sequential
Call waits and post-loop views are supported. This preserves the foundation's
single human-answer ownership instead of inventing parallel approval semantics.
Taskbot has no inbound reply ingestion, so its fallback comments cannot themselves
approve. Push retains the existing content-private category message and opens the
full display; component text is available through the shared fallback, ticket and
terminal paths, rather than exposing artifact bodies on a lock screen.
Notification claims have existing at-most-once crash semantics; a live push
service and actual OS screen reader were not exercised. Native coding-agent
execution/authentication and remote Git operations remain external prerequisites.
No claim covers other binary targets or the minimum supported macOS version.
#141–#148 remain separate tickets.

Implementation gates do not constitute independent acceptance clearance. The
coordinator owns NEW independent review, exact-head CI and merge authorization.
