# F1: focused dashboard APIs and responsive actions

**Date:** 2026-10-19  
**Source:** implementation working tree based on `061d3a5669be3eb68a001517e6c7c1d287582d1b`; the retained receipt records that tested working tree, before shipping commits.  
**Mode:** deterministic mocked agents, isolated temporary home/repository, real EdgeWorker, tracker RPC, workflow runtime and protected HTTP routes. No live inference or production mutations.

The user reported slow Today decisions, answers and retries. API/runtime/activity changes require relevant F1 validation under the canonical applicability policy. The [fixture](assets/api-responsiveness.ts) and [measurement receipt](assets/2026-10-19-api-responsiveness.json) retain the assertions and measured request/response sizes.

## Endpoint audit and changes

| Endpoint family | Data needed by its consumer and resulting behavior |
| --- | --- |
| Run list and Today focus | Progress step identities, current question/choices/recommendations/batch, status, recovery eligibility and short review/proposal summaries. Exclude retained execution, full artifacts and review history. Question/recovery cards do not read activity. Finished cards retain their final response. |
| Run overview and architecture reader | Overview retains conversation answers, ticket links, frozen step names, review identities and the exact impact fields needed for reading progress. Full proposal versions load only on the architecture page. |
| Run mutations | Return accepted run identity/title/current status. The frontend immediately applies canonical state, blocks stale waiting controls until current context arrives, and refreshes only the affected run/list/transcript. Durable save barriers remain. |
| Dashboard configuration | Launch/display workflow metadata, profile choices and the configuration revision. Setup installation probes, full recipe instructions, execution consumers, Git probing, update state and capacity reconciliation do not run for this read. |
| Recipes, execution settings and capacity | Load the full data only on the relevant editor. Recipe PATCH sends changed definitions; default selection sends one ID. Capacity has a dedicated counts endpoint and SSE flag. Terminal reads follow the same separation. |
| Activity, artifacts, review files and media | Bounded activity previews do not stringify whole tool results to discover their size. Explicit raw/artifact/file/media reads retain full data and integrity checks. Small outputs whose fields affect fork links, approvals or readiness retain their prior semantics. |
| Access, push, updates, ticket settings and uploads | Retain their purpose-specific responses and existing origin/build/revision/authorization guards. Authentication hashes a supplied token once per lookup. Native update/drain and full export contracts remain compatible. |

Live events coalesce without cancelling and restarting slow reads. A single event arriving during an independently started read still causes a subsequent fresh read. Recipe/config acknowledgements only advance cache revisions that match the request's captured revision; unrelated stale editor caches cannot acquire a fresh revision and restore revoked permissions.

## Drive and assertions

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm --filter bobs-factory-core test:run
cd packages/edge-worker
pnpm exec vitest run --maxWorkers=3 test/Factory*.test.ts test/WorkflowRuntime.test.ts test/ActivityPage.test.ts test/WorkflowCatalog.test.ts
cd ../..
pnpm --filter bobs-factory exec vitest run src/tui/tui.test.ts src/onboarding.test.ts
F1_AGENT_MODE=mock F1_API_RECEIPT=/tmp/f1-api-responsiveness-complete.json bun run apps/f1/test-drives/assets/api-responsiveness.ts
```

- Create a tracker issue and observe the mocked native response through the real activity RPC.
- Launch a workflow, reach a human question, retain a 2.4 MB artifact and 24 large receipts, then restart the worker.
- Verify the saved question batch and exact context survive; focus/detail responses remain bounded and explicit artifact reads return the entire original value.
- Submit one explicit answer; verify durable continuation and exactly one accepted answer.
- Fail a script, retain evidence, repair its prerequisite and Retry; verify a compact receipt and completion without losing retained evidence.
- Verify separate capacity counts, recipe editing configuration, a guarded partial recipe update and ID-only default selection.
- Shut down both workers and remove the passing isolated fixture.

The receipt includes timings for this local mocked drive. They are observations, not production latency guarantees. In the final drive an answer uploaded 154 bytes and Retry uploaded 2 bytes; both responses were about 109 bytes. A partial recipe edit uploaded 386 bytes, and default selection uploaded 28 bytes. Dashboard configuration was 8,230 bytes versus 97,608 bytes for the compatible full read.

## Verification results

- **Core:** 17 files / 247 tests passed.
- **API/UI/runtime subset:** 26 files / 477 tests passed.
- **CLI onboarding and terminal:** 2 files / 32 tests passed.
- After the final focus activity-read restriction: FactoryServer and FactoryWebClient **73 tests passed**, followed by edge-worker build/typecheck and another passing F1 drive.
- Repository build/typecheck, changed-code Biome checks and `git diff --check` passed.
- Before shipping, integrated main's recorded-decision attribution fix (`c06051c1`) and repeated the mocked API drive successfully. The nightly workflow now runs this same fixture and requires its hashed log alongside the existing full-payload checks.
- Regression coverage includes cold missing payload chunks, small compact previews, checkpoint presence, exact fork-link behavior, event-only final replies, permission revocations across cached editor scopes, late stale reads, action acknowledgement context, and independent-read/SSE catch-up.

Read-only inspection of two existing production snapshots also exercised the actual updated GET handlers in an isolated server with no execution or saves. The question run's prior approximately 5.96 MB dashboard response became a **12,870-byte focus response** and a **93,951-byte overview**. The running run's focus response was **14,367 bytes**. Full retained run serialization was approximately 21.8 MB and 86.1 MB respectively; compact action receipts were 140 and 143 bytes. Production state and the installed running binary were not changed.

## Limits

The T3 collaborative browser repeatedly timed out. The available fallback browser reached the isolated listener but its automation context was rejected with `Direct same-origin loopback access required`; a reload was also rejected. Browser visual/interaction QA is therefore **not claimed**. The protected HTTP F1 flow and frontend query/mutation regressions passed; no access guard was weakened for browser automation.

Older saved architecture/impact arrays can still load a larger historical page on their first explicit read. Future saves use smaller pages. Durable answer/review commits, mutable snapshot capture, activity timestamp indexing and media revision validation retain real work; this change does not prove that every pause under concurrent production load has disappeared. The new build must be installed before these changes affect the user's running app.
