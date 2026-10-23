# Taskbot #144: bounded context and original evidence

Date: 2026-10-23. [PR #181](https://github.com/jappyjan/bobs-factory/pull/181). Implementation evidence, **not independent acceptance**.
Tested product/source commit: `e8dfe3dc9f78acf842cc667990c9a78602094796`.
Base: `fb1cbcea803ba56968462e54747093d42cab2aa9`, tree
`c9b2e286d2f94275c8541346bd56efd80f927787`.
Own checkout: `/Users/jappy/.t3/worktrees/bobs-factory/taskbot-144-context`,
branch `taskbot/144-context`. Manual checkout did not rebind the inherited T3 workspace.
Node 24.21.0 / pnpm 10.33.1; all runtime fixtures use disposable homes.

## Audit and change

Live #144 comment 2502 records the before-replacement audit. Read live #144/#135,
#132 body and delivery 1905, #136 declared-read/provenance interfaces, #143 CLEAN
2491/merge 2493/main-only receipt 2495/completion 2497, and #145's boundary.
No named native runs or private conversation stores were inspected.

#132's v1 projection indexes top-level history but passes nested current values
through. Its complete ledger is retained for native declared reads and authority.
This change adds a lazy v2 MCP boundary, reuses the private content-addressed DAG
across handoffs, and records original history ranges on **new** review baselines.
No competing context store, impact assessor, convergence policy or telemetry was added.

Native outputs, detached declared-read copies, input digests and Check authority
remain complete. Runtime-owned immutable history receipts can be cached; live
mutable outputs are recaptured. The first attempt to share immutable declared
reads broke a mutation/isolation regression; that change and global live-output
freezing were withdrawn. `StepBindings.ts` is byte-identical to the base.

## Exact controlled comparison

[Probe](assets/taskbot144-context/measure.mts),
[complete measurements](assets/taskbot144-context/measurements.json),
[source hashes](assets/taskbot144-context/source-freeze.json).
Both variants execute the same final probe. The base is a **new disposable clone**
at the exact base above, with no product edits. The probe constructs 12/48 rounds
with qualified nested identities, large gate/baseline/impact/prior-output/progress
structures, an old unresolved finding, evidence-backed rejected correction and
changed dependency. It uses actual snapshot preparation and MCP list/read calls.
Current outputs are mutable detached copies; historical receipts are immutable.
No existing saved history was rewritten or pruned.

| Measurement | Base, 12 rounds | Candidate, 12 rounds | Base, 48 rounds | Candidate, 48 rounds |
| --- | ---: | ---: | ---: | ---: |
| Logical serialized history bytes | 2,410,675 | 475,536 | 32,915,743 | 1,942,032 |
| Logical serialized role input bytes | 4,416,056 | 626,167 | 40,729,796 | 2,092,663 |
| Logical new baseline bytes, all rounds | 2,088,811 | 153,672 | 31,629,115 | 655,404 |
| Default root MCP calls | 127 | 1 | 497 | 1 |
| Default root returned UTF-8 bytes | 1,690,371 | 2,100 | 6,628,660 | 476 |
| Default root returned characters | 1,542,771 | 2,100 | 6,049,060 | 476 |
| Default root node metadata touches | 9,745 | 436 | 55,573 | 362 |
| Cold preparation ms / metadata touches | 68.021 / 2,930 | 40.410 / 686 | 557.527 / 34,034 | 105.293 / 2,522 |
| Warm preparation ms / metadata touches | 53.936 / 2,930 | 3.419 / 86 | 574.313 / 34,034 | 5.086 / 158 |
| Cold server construction ms / touches | 20.563 / 1,627 | 2.895 / 1 | 64.117 / 6,055 | 0.640 / 1 |
| Selected current/original/ledger protocol calls / UTF-8 bytes | 133 / 1,692,510 | 7 / 4,813 | 503 / 6,630,799 | 7 / 3,189 |

A root descriptor is an index, **not a claim that its evidence was read**. The
selected protocol separately reads current dependency/status, the original old
finding and rejected correction, browses the exact ledger and reads a late page
of original evidence. Full original values remain explicitly paginated.

Indexing cost is visible: at 48 rounds the candidate's **first explicit ledger
access** takes 73.981 ms / 6,029 metadata touches; a warm reopened snapshot uses
the persisted index in 0.495 ms / 95 touches. The base pays its initial indexing
cost during server construction, before its 0.430 ms / 85-touch ledger read.
Indexing is deferred, not eliminated. Original 64-character tail pages take
0.096 ms / 6 touches before and 0.120 ms / 7 after (warm observations); no
pagination speed improvement is claimed.

| Snapshot storage, 48 rounds | Base | Candidate |
| --- | ---: | ---: |
| Cold DAG apparent bytes / files | 1,020,528 / 1,061 | 876,327 / 1,113 |
| DAG + derived indexes after pages, apparent bytes | 1,147,184 | 1,001,791 |
| DAG + derived indexes after pages, allocated blocks × 512 | 7,041,024 | 7,016,448 |

Transport manifest sizes are recorded separately in JSON. Allocated blocks are
filesystem observations, not SSD usage, free-space deltas or logical JSON size.
The candidate keeps a reusable derived cache; cleanup releases each role manifest
without deleting other roles' evidence. No physical-disk percentage, model cost,
token saving or production timing claim is made. Warm preparation still visits
membership metadata; cold new payloads and immediate wide-container metadata cost
work. The 500-row immutable-cache regression additionally bounds serialization
work and verifies changed mutable descendants are recaptured.

## Mocked F1 and focused checks

F1 is **applicable** to runtime-to-context behavior. The production WorkflowRuntime,
Call/Parallel/For each ownership, native aggregate review action and actual context
MCP server run in source mode with deterministic role callbacks. There are no live
models, native CLI sessions, tracker/forge delivery, API keys, browser or devices.
The host's production cache argument is covered by owning backend compilation;
this is not a complete EdgeWorker intake/service or compiled-binary drive.

[Maintained drive](../../../packages/edge-worker/test/BoundedContextDrive.test.ts),
[actual invocation/gate receipts](assets/taskbot144-context/drive-receipts.json).
The recipe uses a non-default `integration` target, renamed configured review
steps, two configured perspectives, 24 sequential review Calls, and separate
For each → Call readers with explicit bindings and changed per-item inputs.
Requirement extraction remains outside parallel/For each bodies.

Final source drive: **exit 0**, one test, 87.14 seconds. Each of fresh and normal
saved/reconstructed modes completes **74 role invocations, 74 MCP root reads and
24 approved automated gates**, with no duplicated completed role key. The restart
stops after the durable synthetic `r12/catalog` session checkpoint, reconstructs
the real saved runtime and resumes. No checkpoint, receipt or history is patched.
Both modes retain 47,444 logical baseline bytes. Exact character counts and every
invoked role/gate identity are in the linked receipts. There is no human decision
or final-delivery claim. A synthetic session ID proves checkpoint continuity,
not native CLI/provider enforcement or model judgment.

**The exact-base counterpart fails:** the identical final 24-round fresh/restart
drive times out at its unchanged **120,000 ms** limit (exit 1; 123.04 seconds total).
It is not relabelled passing, retried with a larger timeout, or used to claim
complete before/after native outcome equivalence. The separate successful
48-round comparison establishes the context measurements. Current fresh/restart
outcomes agree; old inline context readability and retained conservative approval
behavior have focused evidence below.

| Check / command, explicit owning directory | Actual result and scope |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts`, own checkout and new base clone | Exit 0; unchanged lock/dependencies. Preparation only; install scripts/hooks not credited. |
| `pnpm --filter bobs-factory-core build` | Exit 0, current and exact-base owning preparation. |
| `pnpm --filter bobs-factory-mcp-tools build` | Exit 0, final MCP source. |
| `pnpm exec tsgo --noEmit -p /tmp/taskbot144-implementation/edge-owning.tsconfig.json`, own edge-worker | Exit 0. Source aliases for owning backend dependencies plus the existing `opencode-runner/src/node-sqlite.d.ts`; no weakened checks or added dependency. |
| `pnpm exec vitest run src/factoryContext.test.ts`, own MCP package | 26 passed. Exact frozen helper source: pagination, whole v1 value preservation, v2 nested/work bounds, stale root refusal, complete claims/rejections, cache/mutable isolation, private/integrity/foreign-reference guards. |
| Root focused unit/whole-prompt batch | Three reference tests + two whole-role-prompt tests passed; all **681 complete variants** asserted. Five complete routing prompt tests passed after source-alias preparation. |
| Selected SpecialistReview / provenance / For each batch | Six passed, one real detached-copy regression failed. Repaired regression then passes on base and final candidate (one test each). The other six are scoped reuse, not a new all-green batch. |
| Final `BoundedContextDrive.test.ts` with source config | Exit 0 on final source as above; base counterpart exit 1 timeout. |
| Final measurement probe on each checkout | Exit 0; source hashes stable across each command; results above include deferred indexing work. |
| Focused Biome + `git diff --check` | Passed for changed source/fixtures; final documentation delta reviewed separately. |

Commands use `HOME=/tmp/taskbot144-implementation/home` and
`TMPDIR=/tmp/taskbot144-implementation/tmp`. Focused configs/logs and small receipts
are retained at `/tmp/taskbot144-implementation/`; the report is not a raw archive.
Source-mode configs select workspace sources rather than borrowing another
checkout's emit. The measurement command runs the selected checkout's `tsx` from
`packages/core`, with its matching `*-paths.json`, followed by the committed probe,
checkout path and output JSON path. Final F1 uses `TASKBOT144_DRIVE_RECEIPT`.

## Failed attempts and corrections

- First probe launch had a wrong relative edit path, then failed because the new
  base MCP emit was absent. Corrected isolated source aliases; no product evidence
  from that attempt. Preliminary measurements omitted separate ledger timing and
  used immutable current outputs; final probe explicitly measures ledger work and
  mutable current outputs. Only the final probe supplies the tables above.
- Initial integration setup could not resolve the MCP SDK and an unbuilt transport.
  The drive uses the SDK owned by the MCP package and explicit source aliases.
- Fixture renaming accidentally renamed a tool capability, then put required
  extraction question checkpoints inside For each. Both guards correctly rejected
  the fixture. Calls were reconfigured; product guards were not changed.
- A Call mapping used `/launchInputs` outside its declared scope. Fixed the fixture
  to use a declared `@launchInputs` read and `/inputs` mapping.
- A stopped candidate drive reached 223 MB disposable state at round 11 because
  its Calls inherited earlier Call outputs. Exit 130; it does not pass. Final
  fixture uses explicit empty bindings plus declared mappings. Canonical inherited
  Call-output growth is unchanged and has no performance claim here.
- A fixture wait returned a boolean instead of asserting, so it stopped before
  saving its session checkpoint. Corrected the real wait/save boundary; no saved
  authority state was patched. Preliminary 24-round success preceded the native
  copy repair and is superseded by the final-source 87.14-second drive.
- Real read-copy regression: frozen named reads prevented mutation of a detached
  accepted input. Exact base passes; final candidate restores `structuredClone`
  behavior and mutable live outputs. No assertion or timeout was weakened.
- Temporary source typecheck omitted the repository's existing SQLite declaration.
  Included that original declaration in the probe config; final owning check passes.
- Final evidence JSON needed one array-layout formatting correction; no source or measured value changed.
- GitHub connector PR creation returned HTTP 403; no PR was created there. Existing authenticated CLI created the single non-draft PR181 and it was immediately linked to the owner/parent and attached to #144. First push ended with SSH public-key exit 128; explicit HTTPS push then exits 0. Normal LFS pre-push reported 1/1 object, 100 MB, 0 B/s; no new LFS-tracked asset is part of this change. No native key inspection or auth/remote policy edits.
- SSH main fetch was stopped with exit 130 after no output. A separate explicit
  main-only HTTPS fetch using existing `gh` credentials exits 0 and confirms the
  exact base. No global auth, remote, signing or protection policy changed.

## #144 and epic disposition

| Requirement | Implementation evidence / limit |
| --- | --- |
| Bounded nested default view; actual declared inputs/delta/active work | Generic v2 projection at every requested object path; nested gate/impact/prior-output/progress stress, current dependency and full prompt guidance. Native named-read copying and canonical values remain intact. |
| Every historical finding/disposition/disagreement/rationale | Exact v1 claim semantics retained; lazy complete ledger/round indexes, original first/latest paths and paginated originals. Old unresolved finding and evidence-backed rejected correction retrieved. No summary supplies acceptance. |
| Immutable originals, stable identity/revision/ownership | Root-bound content-addressed agent snapshots; wrong-root, missing/stale/foreign history-range regressions; original qualified receipt cutoffs restored before native checks. Native store integrity and executed producer guards remain separate authority. |
| Avoid baseline history copying; saved compatibility | New baseline `contextReferences` records run/range/index digest; zero old payload loads during capture regression; saved reconstruction and legacy inline readability. No persisted history rewrite, pruning or accepted graph upgrade. |
| Bounded work as well as bytes | Lazy index, metadata/page counters, visible first-index cost, trusted immutable cache and mutable freshness tests. Cold capture/current mutable copies and wide-container metadata remain real costs. |
| Generic custom/renamed/nested reads | Private runtime history provenance, no step leaf/repository/provider switches; native declared reads unchanged; Call/Parallel/For each and accepted-input mutation/provenance checks. |
| Actual instructions/capability/full prompt fixture | Runtime MCP browsing guidance and capability reference deliberately updated; complete fixture and routing prompt assertions. Saved graph/prompt bodies/native histories are not rewritten; next turns receive updated runtime context guidance. |
| Fresh/saved/restart valid outcomes | Current 24-round fresh/restart drive agrees and preserves synthetic checkpoint/session; focused conservative/inline compatibility. Base 24-round timeout remains failed, so no blanket before/after runtime equivalence or real-model claim. |
| Independent impact/reuse/convergence/native authority | #132 mechanisms reused, no #145/#147 implementation. Original input digests, Checks, exact human/provider/permission/delivery/final-proof guards remain required; no reference upgrades incomplete evidence. |
| Epic generic-building-block decisions | Existing formats/configured roles, Calls/Parallel/For each/Check/human/action owners retained; declarative views and forkability unchanged; deleted Improve remains deleted and model inheritance unchanged. No runtime fixture IDs/toolchain assumptions added. |
| Delivery and validation policy | One ready PR, `[skip ci]` subjects, changelog/contracts/reference/report. Parent owns independent Standards/Spec, status, guarded squash and later sequence. CI/full monorepo/native/browser matrices deferred to post-148, not passed. No dependencies changed. |

Read-only/context-only/late Ask/private-error/push-consent/assets and #143 saved
reader/current Ask/guide/progress paths are unchanged. #141 atomic receipts/no
false completion/child replay and #142 original-frame revisions, enclosing inputs,
sessions, visits and accepted mappings retain their owners. This is source-scoped
preservation, not a replay of their native or delivery matrices.

The three known #143 exact-base fixture failures remain **FAIL/deferred**: the old
ReviewFiles pipeline-guide 409 and two mixed TicketDelivery fixtures missing
original executed clarification/plan/review producers. They were not rerun or
weakened. The original external missing-final-proof negative control remains a
failure, never final delivery. #132 delivery 1905's real-model/provider/browser/
media/stream limitations and #143 2491 qualifications remain historical limits.

No UI flow changed, so no screenshots or browser/device replay were invented.
Both disjoint helpers completed without pending work at priority/xhigh. Final
handoff records exact HEAD/TREE/base, source-hash authentication and cleanup after
publication. Tracked hooks/configuration remain intact; the configured checkout
has LFS hook wrappers and no pre-commit wrapper, so absent broad hooks get no credit.

## Final publication delta

The final follow-up commit changes only this report, the changelog PR link and the context compatibility documentation. All 16 frozen source/fixture/probe hashes remain exact; no source or harness changed during checks. Newly written reference-bearing baselines need a compatible runtime; an older reader is not a supported rollback for those new records. Original receipts are retained. This is repository delivery only, not an installation, service restart, active-run edit, production upgrade or downgrade. Final HEAD/TREE and cleanup are recorded in the direct #144 implementation handoff.
