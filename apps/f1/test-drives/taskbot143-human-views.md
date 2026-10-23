# Taskbot #143: declarative stock human views

Date: 2026-10-23. Base: `6ebabd6fc8035fa851eb5415f4306bc358d0cd49`
(`ed04d63cfd2cae5f13c2a1e492d2853b12cb590a`). Node 24.21.0; pnpm 10.33.1.
Implementation: [PR #180](https://github.com/jappyjan/bobs-factory/pull/180). Initial
source `884bfc56ef2f4112afc5118c2206a63c937f75c2` and docs head
`6a25974db454adc66a9cc9461b430ec3d96aabd6` remain historical; independent Round1
report2472 found that candidate **NOT CLEAN**. The combined R1–R4 repair below
supersedes it for new independent review; no acceptance clearance is inherited.

## Combined Round1 repair

| Finding | Root cause and correction | Executed changed-path proof |
| --- | --- | --- |
| R1 terminal native review | Terminal callbacks omitted required native display consent. Both now capture the displayed digest plus native review ID/head/external identity before opening confirmation; neither callback fetches or substitutes a newer digest afterward. | Actual TodayApp keyboard actions/callbacks → real FactoryClient → protected FactoryServer accept both current Approve and Request changes. After ordinary public producer content changes and the terminal cache refreshes, each already-open callback still submits the old consent, receives409 and leaves the pending gate/history untouched. Refresh/review/new confirmation then succeeds. |
| R2 native text | An empty generic display string prevented the nullish fallback. Empty generic text now falls back to the current native text; nonempty generic text keeps its existing priority. Native text includes the current batch/review/proposal identity and safe repository coordinates, without borrowing historical review links for an Ask. Existing text budgets/private projections remain. | Real GET contains the customised declared component content and exact current review ID, URL and head. The actual terminal run renderer displays that content. Current Ask GET/text and synthetic ticket notification contain the current question and batch. Inert escaped punctuation is preserved. |
| R3 historical reading | No gate meant no native presentation, so ReviewPage hid the saved guide. Completed gate-less runs now receive a stock **read-only** declaration/resource only from the accepted, executed configured guide producer. It precedes historical proposal metadata, creates no pending gate and grants no native approval. | Existing persisted legacy fixture → real runtime/GET → actual ReviewPage SSR renders both the accepted overview and chapter “Read me”; no false “No review guide yet,” Approve or Request changes. Original revision/reading-progress key assertions remain unchanged. |
| R4 rejected review then Ask | Retained rejected gates won both kind and owner selection. Current architecture/pending-review gates remain native; a current question batch now wins over historical review/proposal records and supplies its own step/frame owner. | Legitimate exact protected terminal rejection → executed correction Ask → normal shutdown/reconstruction → exact current question answer through protected terminal HTTP. Ask preset/component/owner and batch persist, synthetic TicketTracking comments deduplicate, and the rejected gate plus human history stay byte-equivalent. No accepted receipt/checkpoint/history was patched. |

Repair verification uses Node24.21.0/pnpm10.33.1 in the retained own checkout.
`NativeViewChannels.test.ts` is a source-mode controlled integration drive, with
deterministic in-process agent/tool hooks, real protected HTTP, normal ephemeral
terminal authentication and an in-memory tracker adapter. The worker/native
provider lifecycle is not started and no paid/model/forge/live tracker effect is
claimed. Historical persistence is the separately labelled existing compatibility
fixture, not execution or approval evidence.

Current commands/results (raw logs `/tmp/taskbot143-r1-repair/`):

- First three-file focused run: **exit1,14PASS/4FAIL**. The four new assertions
  expected unescaped inert punctuation or chapter text on the overview page.
  Those failed attempts remain recorded; corrections changed the new assertions
  and route page selection, not existing expectations or production safeguards.
- Corrected NativeViewChannels + LegacyPresentation: **exit0,15PASS**. Existing
  NativeViews'3 checks passed in the first run and were not duplicated. A final
  narrow historical-selection delta precedes retained proposal metadata; its
  owning compile and historical route/progress selection rerun both exit0
  (**1PASS/11filtered**). The earlier callback/current-Ask paths are reused with
  that precise scope qualification.
- Owning source `tsgo --project /tmp/taskbot143-tsconfig-owning.json --noEmit`:
  exit0, including the final historical delta. Narrow actual terminal app/model
  source compilation: exit0 after correcting the external alias entry's missing
  QuestionChoices type export and JS import extensions. The first alias-only
  preparation failure remains retained; no product type assertion was weakened.
- Scoped Biome on six changed source/test files: exit0; `git diff --check`: exit0.
  No source/test/harness edits occurred during checks. No broad hook result is
  credited; this checkout has no pre-commit wrapper. No dependency, prompt,
  capability-reference or role-text change was needed: these repairs restore the
  already documented native protocols and historical compatibility.

[Repair input/log hashes and reuse scope](assets/taskbot143/round1-repair.json)
retain the six changed source/test hashes and failed attempts. All other product
source is unchanged from the reviewed candidate, including every web renderer,
View schema/presets, code tour, question defaults/custom resolver, architecture
validator, generic human engine, safe assets, final delivery/uncertainty owners and
141/142 frame/session/visit/freshness/limit guards. The prior32 screenshots and
303dd6de shell retain their original qualification; no new web build, browser
matrix, research/native/four-delivery pipeline or three known baseline failures
were replayed. Current repair tests/compiles are distinct from authenticated or
reused earlier evidence. CI and broad/post148 checks remain deferred. Parent owns
new independent whole-diff Standards/Spec acceptance at the combined repair head.
Test cleanup stopped the actual terminal streams/timers, runtimes and protected
servers;36344 had no listener afterward. Temporary homes were removed by
afterEach. No browser/preview or watcher was opened during this repair.
Publication preparation retained an SSH fetch failure128 (publickey denied).
HTTPS uses the existing authenticated helper without inspecting credentials or
changing saved configuration. The first short HTTPS refspec interacted with the
existing prune setting and removed only the remote-tracking main ref; an explicit
full-ref `--no-prune` fetch restored it. Provider, fresh fetch and local base all
remain `6ebabd6f`/tree`ed04`; no source history or candidate base was retargeted.
The normal commit attempt stalled in its configured SSH signer and was cancelled.
The combined branch commit uses a per-command `commit.gpgsign=false` override;
saved signing settings, hooks and guarded merge policy were not changed. No
credential/key values were inspected and no cancelled signing result is credited.

## Original implementation evidence (historical)

F1 is applicable: this changes native human presentation, protected decision APIs
and ticket text. This drive uses the actual protected **FactoryServer and
WorkflowRuntime in source mode**, deterministic agent/tool hooks and a synthetic
in-memory tracker. It is not a full EdgeWorker drive, native provider permission
attestation, live model run, forge mutation or production deployment. No paid
provider calls were made. Source aliases avoid building unrelated packages.

## What changed and what remains authoritative

Accepted `step.view` declarations select Ask, Approve, Review and External review
presentations. Three inert components reuse the existing answer form, check-in
beats and rich guide/code tour. The native gate remains separate from the
authored preset: generic `accepted: true`, component labels and ordinary JSON
cannot grant native approval. The original native validators still accept the
exact current question batch, proposal/candidate/assets, repository URL/head set
or verified external contract. A public display digest additionally binds the
accepted view/configuration, declared inputs, current guide, native gate and safe
media. Hidden optional components do not remove native obligations.

Frozen definitions with no view get an in-memory stock declaration; accepted
graphs are not rewritten. Their original native client/channel protocols remain
usable. Newly explicit native approval views require display consent. Ask retains
its original terminal/ticket context protocol. `view-v1` and its fourteen original
components remain supported. New components use shared save/render/runtime schemas
and bounded inert text fallbacks, safe URLs and existing asset readers.

The code-tour implementation was reused, not copied. The one final functional
integration fix makes its controller read the trusted native guide independently
of whether a fork includes the optional rich component.

## Controlled scenario and outcomes

The same four persisted paused flows supplied before and after images. Restart
preserved the accepted definitions, question batch/history, proposal and native
review/delivery identities without replaying agents. The original before shell
was built before UI replacement; it was not recreated afterward.

| Boundary | Consequential evidence |
| --- | --- |
| Questions | Recommendation/choice defaults remain unsubmitted. An explicit blank custom choice focuses its textarea, disables Send and refuses keyboard submission; answers stay empty and the batch stays current. Runtime/API tests refuse changed recommendation content and generic forged approval, then accept the current explicit answer. Existing question tests cover stale batches, conflicts, retry/recheck and context ownership. |
| Check-in | Ordinary Recipes UI forks Factory, edits View JSON, saves, exports and reloads: size comes first, optional notice/notes disappear and a component binds the proposal's actual candidate plan. A separate real Factory fork runtime test repeats Save/export/reload through the protected API, reaches planning/review/check-in, accepts the exact native proposal and candidate, and reaches the controlled implementation boundary once. The boundary intentionally stops with a fixture error before implementation; it is not a completed Factory delivery. Existing architecture checks retain asset, candidate and routine-bypass behavior. |
| Review | The existing show & tell, Dig deeper and real 76-file retained diff tour render through one rich component. Item comments update the sticky count and appear on Decide. Reading page restores on reload. New tests bind a renamed configured guide and separately change **both URL and head for each of two repositories**, refuse stale/missing display consent and retain both exact repository identities on native acceptance. Hiding the rich component keeps native controls and no longer crashes. |
| External review | The stock view displays an actual frozen synthetic external contract, independently applied/verified tracker receipt and original ticket evidence. Current contract/digest and exact human decision remain native. This fixture does not execute the complete external-final pipeline; native human acceptance is not final provider proof. Unchanged final drift, uncertainty and delivery tests/evidence remain separately qualified below. |

The final source build `303dd6de46c4d94910b26ed9` passed a narrow actual review
smoke (guide, enabled native approval/rejection controls, no alerts). Same-origin
browser fetches then exercised the actual protected APIs with normal request/build
headers and no credential reads:

| Request | Actual result |
| --- | --- |
| Stale display on each of Questions / Check-in / Review / External review | Four HTTP 409 responses; native histories and pending identities unchanged. |
| Current review display with wrong head; current external display with wrong external digest | Two HTTP 409 responses; native histories unchanged. |
| Current explicit native question answer | HTTP 200; one retained answer, then a new batch from the deterministic question hook. Not completion. |
| Exact native proposal/version/digest acceptance | HTTP 202; proposal accepted, accepted plan hash exactly equals candidate hash `43c7a470…d6031f`. |
| Exact native repository review acceptance | HTTP 202; retains the current URL and full `6ebabd6f…` head; no merge hook or forge call. |
| Exact native external acceptance | HTTP 202 records the exact verification digest; completion then **fails** with `External delivery lacks verified acceptance and final state proof`. The fixture has no external-final route. This is a negative final-proof guard observation, not successful external delivery. |

A separate fresh controlled channel probe uses the actual terminal `FactoryClient`
and a normal ephemeral local terminal session against the protected HTTP server.
It answers a renamed explicit Ask without the new web display field and completes
with exactly one answer. The actual EdgeWorker prompted-reply handler, connected
to a fresh scripted runtime before creating its run (worker not started), accepts
the native ticket reply and deduplicates the same activity on redelivery. No
accepted checkpoint/history/receipt was patched, and no real tracker or provider
was called. This is focused channel integration, not a full EdgeWorker lifecycle
drive. Raw probe/command receipts are retained outside the checkout and hashed in
the compact evidence file.

The browser probes cover 360px overflow (document/body both 360 for all four
views), native radio/checkbox/textarea controls, blank-custom keyboard refusal,
comment focus, sticky feedback count, Decide and reading-page restoration. The
fixture has a genuine retained diff but **no authored line-note pins**; no browser
line-note interaction is claimed. Existing functional `ReviewDive` tests cover
added/removed/unchanged pinned-line anchoring and passed. No native OS screen
reader or physical-device claim is made.

## Focused verification and retained failures

All commands ran from the isolated `taskbot-143-human-views` worktree or its owning
package. The manual worktree did not rebind the inherited T3 workspace. Compact
source/log hashes are in [evidence.json](assets/taskbot143/evidence.json); raw logs
remain under `/tmp/taskbot143-*.log`. No source/test/harness edits occurred during
checks. Freeze 2 changes only `focus.tsx` and adds the hidden-guide branch assertion
to the existing LegacyPresentation test; unchanged evidence is reused by hash.

| Command/scope | Actual result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Exit 0; 757 reused, no downloads. No dependency/lockfile changes. |
| `pnpm --filter bobs-factory-core build` | Exit 0; necessary owning dependency preparation only. |
| Initial `View.test.ts Questions.test.ts` | 128 passed. |
| Source-alias owning and web `pnpm exec tsgo --project /tmp/taskbot143-tsconfig-{owning,web}.json --noEmit` | Both exit 0 after setup correction. The owning config includes the existing OpenCode sqlite ambient declaration; it does not change product types. |
| Five-file native boundaries batch | 52 passed: NativeViews, AskView, LegacyPresentation, HumanViewsApi, Architecture. |
| Frozen 20-file focused batch | **Exit 1: 227 passed, 4 failed, plus one suite preparation failure.** See qualifications below; not reported as a green suite. |
| Bounded serial source-alias `pnpm exec vitest run --config /tmp/taskbot143-focused.config.mts test/NativeViews.test.ts test/prompt-assembly.routing-context.test.ts` | Exit 0; 8 passed. Resolves the concurrent 5-second fork timeout and missing emitted transport entry without changing test outcomes or native guards. Complete capability/prompt fixture retained. |
| Unchanged terminal UI tests through owning source aliases | Exit 0; 4 passed, 17 intentionally filtered. Explicit native choice/custom answers and exact recheck context remain available. No live terminal/provider effects. |
| Filtered `TicketTracking.test.ts WorkflowRuntime.test.ts` native question retention checks | Exit 0; 10 passed, 167 intentionally filtered. Covers notification dedup across restarts/content changes, retained Q&A and accepted-answer crash recovery. |
| `node …/tsx/dist/cli.mjs --tsconfig /tmp/taskbot143-human-views/tsconfig.json /tmp/taskbot143-native-channels.mts` | Exit 0; actual protected terminal answer and actual prompted ticket-reply handler each retain exactly one explicit answer; redelivery deduplicated. All synthetic runtimes/server stopped. |
| Freeze-2 `LegacyPresentation.test.ts` | Exit 0; 12 passed, including hidden-guide rendering with retained native controls. Existing assertions unchanged. |
| Freeze-2 web source `tsgo` and scoped Biome | Exit 0. The first attempted `pnpm exec tsc` exited 254 because this repo supplies `tsgo`; that failed command remains recorded. |
| `git diff --check` | Exit 0. |

The 20-file batch covers NativeViews, AskView, ReviewGuideComponent,
ArchitecturePage, Architecture, Questions, FactoryReviewContext,
FactoryReviewState, FactoryReviewFeedback, ReviewDive, ReviewBrief, ReviewFiles,
LegacyPresentation, DeclarativeView, HumanViewsRuntime, HumanViewsApi, ViewAssets,
HumanViewTicketDelivery, TicketDelivery and the full routing/capability prompt
fixture. Existing tests were not relaxed: the only pre-existing expected fixture
change is the entire shared capability text addition; LegacyPresentation gains a
branch assertion. No partial prompt assertion was introduced.

Three failures also reproduce with an **exact-base source overlay**: ReviewFiles
`authorizes API requests...` expects an outdated `pipeline/guide` binding (409
instead of 200), and TicketDelivery `corrects mixed external feedback...` /
`routes rejected mixed review...` lack the original executed clarification/plan/
independent review producers now required by the native guard. The control command
exits 1 with the same three failures and 26 filtered tests. Its Vite resolver uses
`git show 6ebabd6f:<path>` for every modified existing source file, runs in this
worktree, and does not execute an old checkout. These failures remain failures,
not acceptance clearance. Other initial preparation failures (missing workspace
emits/rootDir/ambient setup, Ask SSR PWA mock, control alias and terminal package
entry) are retained by log hash; corrections changed local setup or the new SSR
fixture, without weakening production checks.

Cleanup: both preview hosts shut down normally, the final preview tab closed, and
listeners on 36143/36144 were absent afterward. Probe homes/logs remain local for
inspection. No CI/release watchers were started. No production run was edited.

Git used its configured normal hook path. This checkout had only untracked Git
LFS post-commit/pre-push stubs, with no pre-commit wrapper; no broad build/type/test
hook ran or is credited. No hook was bypassed and no manual broad rerun was added.
The untracked local stubs are retained outside the checkout during final cleanup.

Per epic135's current user policy: no CI/check-field/status-rollup/workflow query,
trigger, watcher or main-health wait; every published commit includes `[skip ci]`.
Full monorepo build/type/lint/package/app/script/audit/native/full-suite repetition
is deferred to the consolidated post-148 phase, not claimed passed here. No new
dependencies require an audit. Unchanged #142 CLEAN2432 / merge2434 /
completion2435 and #141 research/native evidence are baseline qualifications only;
their full delivery/provider pipelines were not replayed or credited as new #143
execution. Independent Standards/Spec acceptance and merge belong to the parent.

## Before/after UI comparison

Desktop is 1440×1000 CSS pixels; mobile is 390×844. T3's retained desktop PNGs are
scaled to 1280×889 pixels and mobile PNGs to 780×1688; the CSS viewport dimensions
come from the actual page. Both themes use the same paused flow, not a regenerated
pipeline. Before shell: `b2755fc919b46c9bca8dba40`. After matrix shell:
`f32b485a2b44ade75069ccf7`. These after images cover the guide-present branch before
the final hidden-guide controller fix. Final narrow rebuild/smoke is recorded
separately; there was no repeated matrix.

Before provenance: original web renderer and five original formatter transpiles,
captured before replacement. The source host used actual production server/runtime
code with additive backend declarations and frozen synthetic workflows; it is not
claimed to be a full exact-base host build. Raw screenshot bytes and hashes are in
[images.json](assets/taskbot143/images.json). Original T3 paths/provenance remain in
`/tmp/taskbot143-human-views/{before,after}.json`.

Compared outcomes: native text/choices/reactions, show & tell and ticket evidence
remain readable. Declarative component containers add spacing and can change
wrapping; these cosmetic differences are deferred. The functional 360px checks
found no horizontal overflow. No HTML/CSS injection or fabricated product page
was used.

| Screen | Viewport/theme | Before | After |
| --- | --- | --- | --- |
| Questions | Desktop light | [Before](assets/taskbot143/before/questions-desktop-light.png) | [After](assets/taskbot143/after/questions-desktop-light.png) |
| Questions | Desktop dark | [Before](assets/taskbot143/before/questions-desktop-dark.png) | [After](assets/taskbot143/after/questions-desktop-dark.png) |
| Questions | 390 light | [Before](assets/taskbot143/before/questions-390-light.png) | [After](assets/taskbot143/after/questions-390-light.png) |
| Questions | 390 dark | [Before](assets/taskbot143/before/questions-390-dark.png) | [After](assets/taskbot143/after/questions-390-dark.png) |
| Check-in | Desktop light | [Before](assets/taskbot143/before/checkin-desktop-light.png) | [After](assets/taskbot143/after/checkin-desktop-light.png) |
| Check-in | Desktop dark | [Before](assets/taskbot143/before/checkin-desktop-dark.png) | [After](assets/taskbot143/after/checkin-desktop-dark.png) |
| Check-in | 390 light | [Before](assets/taskbot143/before/checkin-390-light.png) | [After](assets/taskbot143/after/checkin-390-light.png) |
| Check-in | 390 dark | [Before](assets/taskbot143/before/checkin-390-dark.png) | [After](assets/taskbot143/after/checkin-390-dark.png) |
| Human review | Desktop light | [Before](assets/taskbot143/before/review-desktop-light.png) | [After](assets/taskbot143/after/review-desktop-light.png) |
| Human review | Desktop dark | [Before](assets/taskbot143/before/review-desktop-dark.png) | [After](assets/taskbot143/after/review-desktop-dark.png) |
| Human review | 390 light | [Before](assets/taskbot143/before/review-390-light.png) | [After](assets/taskbot143/after/review-390-light.png) |
| Human review | 390 dark | [Before](assets/taskbot143/before/review-390-dark.png) | [After](assets/taskbot143/after/review-390-dark.png) |
| External review | Desktop light | [Before](assets/taskbot143/before/external-desktop-light.png) | [After](assets/taskbot143/after/external-desktop-light.png) |
| External review | Desktop dark | [Before](assets/taskbot143/before/external-desktop-dark.png) | [After](assets/taskbot143/after/external-desktop-dark.png) |
| External review | 390 light | [Before](assets/taskbot143/before/external-390-light.png) | [After](assets/taskbot143/after/external-390-light.png) |
| External review | 390 dark | [Before](assets/taskbot143/before/external-390-dark.png) | [After](assets/taskbot143/after/external-390-dark.png) |
