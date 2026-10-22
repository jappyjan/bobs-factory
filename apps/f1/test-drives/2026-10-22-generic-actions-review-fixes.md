# Generic actions: B1 and independent review repairs

Taskbot [#139](https://taskbot.apps.janjaap.de/p/bobs-factory/t/139), part of
[epic #135](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135),
[PR #176](https://github.com/jappyjan/bobs-factory/pull/176).

All results below ran on the clean combined source
`dcbe5c3d1b2a837b9ae40f06e29b5b63c73cf639`, tree
`cb7d62d9c8ee427b338790c35b43bae704c2a7a2`, based on
`791b7405f78c654c07e58c0395a4802e6229bf0a`.
Node **24.21.0**, pnpm **10.33.1**, Bun **1.4.2**, macOS ARM64.
The retained implementation checkout is
`/Users/jappy/.t3/worktrees/bobs-factory/taskbot-139-actions`, branch
`taskbot/139-actions`; the inherited T3 thread binding was not changed.

The [initial report](2026-10-22-generic-actions.md) and its original receipts
remain historical evidence for `ae847b35`/`fd16`. They do not validate the repaired
backend. Independent review of immutable `fd16` requested R1/R2; B1 was a separate
confirmed baseline regression. This report supplies new combined-source evidence
for all three. New independent acceptance and revised-head CI remain parent-owned.

## Findings and repairs

| Finding | Before | Repaired behavior and protection |
| --- | --- | --- |
| B1: declared delivery candidate | Stock/frozen reviewers bind `scopePlan`, but three runtime input projections looked for an unbound read named `plan`, supplying the digest of null. | All three projections use the accepted `scope-inputs.sources.plan` named read. Existing explicit `reads.plan` partners remain supported. The reviewer echoes the runtime digest; both actual acceptance actions still reject wrong/stale contracts. |
| R1: paused observation | Stop prevented reconciliation as well as dispatch, leaving original child status/proof stale across restart. | Original child identities, progress and provider proof continue to update operational tracking while admission remains paused. The parent stays stopped and the dependent stays queued. Already-admitted children may resume ordinary work after parent-first reconstruction. |
| R2: mapped Snapshot | A valid independently saved callee reading `@callInputs/baseline` could not consume its caller's real Snapshot. | Private persisted graph-frame provenance binds the original run/receipt/producer/lexical item, scope/revision/digest, accepted mapping/target and frozen Call inputs. Real Call/For each result paths retain exact original runtime wrapper receipts. Public equal JSON never grants authority. |

B1 changes no acceptance gate, output-format activation, accepted definition,
original receipt or native session. It adds no `outputs.plan` fallback. A genuinely
archived legacy definition is loaded from disk and resolved in memory without
rewriting it. The fully renamed complete Factory fixture now faithfully echoes
`context.input.deliveryCandidateDigest`, rather than calculating a digest in the mock.

R1 retains save-before-create, uncommitted-child, explicit batch-cancellation and
paused-wave guards. Observation cannot create/admit a child or change a stopped
parent. Original action outputs stay immutable; only operational progress changes.

R2 uses runtime-owned metadata separately from public Call JSON. It supports
renamed callers, nested Call/For each, per-item producers, actual returned whole
Snapshots and frozen-input restart/backfill. Copied/literal JSON, foreign runs,
wrong lexical/item frames, altered inputs, sibling substitution and stale wrappers
cannot mint trust. A new mapping must select the current original wrapper; an
already accepted mapping retains its original wrapper receipt. The explicit reusable
callee saves without knowing a caller step name. The old named-ancestor workaround
is not required or claimed as a resolution.

[Machine-readable finding responses](assets/taskbot139-review-fixes/final/finding-responses.json).
Focused checks passed before freeze: 66 tests across seven files, plus 22 ticket
delivery tests. The final full suite below includes all new protection:
`DeliveryCandidateDigest` (9), `ActionRuntime` (21), `SnapshotCallMapping` (14),
unchanged `RepositorySnapshot` (4), renamed Factory, delivery and full capability
prompt suites. Prompt assertions still compare the entire expected prompt.

## Final clean local gates

| Check | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck` | PASS |
| `pnpm lint`, `pnpm exec biome ci` | PASS; existing warnings retained |
| `pnpm test:packages:run --maxWorkers=2` | 329 files, 4,142 passed, 2 skipped |
| Complete CLI / F1 application suites | 254 / 17 passed |
| Complete desktop suite | 41 passed, 1 skipped |
| Complete script suite | 179 passed |
| Executable action/UI driver syntax | PASS |
| `pnpm audit --json` | Zero advisories |

Two Vitest workers per package and serial workspace packages bound aggregate
memory/process use on this 8-logical-CPU, 16-GiB machine. No dependencies changed.
[Gate summary and commands](assets/taskbot139-review-fixes/final/gate-summary.json)
link the source, timings and raw logs. No source edits occurred during final checks.

## Final mocked workflow drives

F1 applies to these runtime and functional fixture changes. All six drivers ran
serially on the same clean combined source, using actual EdgeWorker/CLI and
runtime boundaries with controlled trackers/agents and disposable Git/test homes.

| Driver | Result |
| --- | --- |
| Original architecture decision brief, unchanged | PASS, 115.66s; intended stock Factory/Takeover architecture checkpoints and expected invalid-revision rejection |
| Architecture approval continuation | PASS, 6.17s; all 25 original outcome assertions retained |
| Impact feedback recovery | PASS, 4.75s; all 17 original outcome assertions retained |
| Workflow stall recovery | PASS, 10.72s; all 64 original outcome assertions retained |
| API responsiveness, unchanged | PASS, 13.36s |
| Generic action drive | PASS, 36.46s; three scenarios, six mocked sends, eight mocked turns, zero paid calls |

[Exact commands, source/build/driver hashes and logs](assets/taskbot139-review-fixes/final/f1/drivers.json)
and [action results](assets/taskbot139-review-fixes/final/f1/actions-results.json).
Runtime source SHA-256 is
`84ae4089c33bffa12e5b91fdb97fccb7d12e4f5764fadf496774555e1a3e4a53`;
compiled Runtime JS is
`e75773a9429093f392e6c2ada2f7b7a65032d4a5241e1a454a3c83de5dda13a2`.

The action drive ran **03:45:52–03:46:28 UTC**. Its exact driver SHA-256 is
`ccc1548280630385c542b5b472fd0063402299ae8dd218453bebe12b0ca25b3c`;
executed build digest is
`d3686b9f436f21377cb6fed5bd087b1f440c6f4cb69f4d642f8361c7e2677cf2`.
The drive retains Snapshot→agent→File issues→Launch runs, exact approval/provider
merge waves, both wait modes, lost-response reconciliation with zero duplicates,
independent worktrees, stop/resume/batch stop and worker reconstruction. It now
also saves a reusable Call mapping and exercises its production pinned MCP access,
then observes an original child's confirmed merge while stopped, reconstructs the
worker with the dependent still queued, and resumes the original wave. Accepted
receipts and child identities remain unchanged. Late closed-ticket progress is
honestly superseded by the existing tracker safeguard, not reported as delivered.

### Fixture corrections and retained failures

The originally skipped drivers had stale fixture setup, exposed before freeze:

- Reduced architecture graphs now execute real context/plan producers and declare
  their semantic reads, including renamed architecture-decision reads.
- Impact uses exact producer-history receipts and the original lexical pending
  frame, rather than removed root aliases. Its already-verified original run is
  explicitly stopped before a synthetic recovered run reuses the same workspace.
- Stall uses the actual archived legacy graph for its historical budget
  fingerprint. Its mocked PR URL has an executed producer and declared read;
  direct admissions retain actual runtime-owned repository/provider scope.
  Completed synthetic phases stop durably before later same-workspace restart
  scenarios. The intended retained run resumes alone.

All existing outcomes, native conversation checks, current approval checks,
allowance 8 / explicit additional 4 / total limit 20, immutable-definition checks
and restart assertions remain. No lease, Git allowlist, timeout, merge proof or
approval check was weakened. No blanket timeout increase was used.
[Exact before files, per-round diffs and assertion-retention proofs](assets/taskbot139-review-fixes/fixture-proofs/round6-proof.json)
are retained alongside the earlier rounds.

[B1 preliminary evidence](assets/taskbot139-review-fixes/preliminary-b1/renamed-echo-red.log)
includes the faithful-echo red test and B1-only compiled runs.
[Combined preliminary failures](assets/taskbot139-review-fixes/preliminary-combined/focused-drivers.json)
remain separate from final evidence. A newly added receipt assertion first caught
JSON storage omitting optional undefined fields; another captured a receipt before
actual publication. The proof now compares the persisted JSON value after the
real action publishes it. A subsequent action run passed functional assertions but
correctly failed its source guard because docs/harness edits overlapped that
preliminary run. The final clean run passes the unchanged stability guard.

## Fresh compiled-product smoke

A new clean macOS ARM64 executable embeds Bun 1.4.2. SHA-256:
`2ca94d36d8c8a38b34c8712d47d8316450ff73a0e31efc28a0199f65d37bbf96`.
[Build identity](assets/taskbot139-review-fixes/final/native/build.json),
[commands/results](assets/taskbot139-review-fixes/final/native/checks.json) and
[action smoke receipt](assets/taskbot139-review-fixes/final/native/action-smoke.json).

Canonical startup/API/assets/MCP/shutdown/restart smoke passes. Additional compiled
checks save and retain a reusable Snapshot Call mapping across restart, reject a
manual-only launch target, preserve zero created runs, and exercise committed
blob access/private-path/foreign-repository denial with an OS-only PATH. The
unmodified build descriptor's builder label says pending runtime smoke; the
separate executed smoke receipts establish these results.

No native coding-agent action execution, live forge/tracker/model quality, other
platform support or release publication is claimed. Git and prepared external
agents/credentials remain prerequisites; native stores and conversations are untouched.

## UI reuse and source integrity

The [scoped UI proof](assets/taskbot139-review-fixes/final/ui-scoped-proof.json)
matches all eight recorded renderer/UI-driver inputs, the complete web-source
diff, and all nine compiled assets of build `0a27c450bb0326b3340d8a68`.
It reuses the [16 original inspected screenshots](assets/taskbot139-actions/ui/ui.md)
for desktop/390px, light/dark, child lists/waves/statuses, parent links, editor
validation and stop/restart/resume/batch controls. Changed backend inputs are
explicitly excluded; the repaired runtime has new tests, F1 and native evidence.
No identical-renderer recapture or accepted-state gallery patch was performed.

[Frozen input inventory](assets/taskbot139-review-fixes/final/source-inputs.json)
authenticates 1,170 scoped source/test/driver inputs, digest
`5a9d0a6788e688891f956950892f1cec6ea2b65bc7ce40a6e4a5af2e2cd7379f`.
The later evidence-only commit changes only this report and its new raw-evidence
directory. Original evidence is untouched. Raw logs/before-files intentionally
retain their original whitespace; the local raw-evidence Biome configuration
preserves bytes. Production changes and canonical executable F1 drivers remain
under normal lint. The new raw native smoke driver was syntax-checked and executed.

## Baseline qualification

Ordinary main CI `39704282012` genuinely succeeded at exact base `791b7405`.
The separate scheduled [release validation `39706122085`](https://github.com/jappyjan/bobs-factory/actions/runs/39706122085)
failed before #139 at that same base with B1's exact-digest error; later recovery
commands were skipped. Taskbot comments 2143/2153 preserve the original diagnosis
and review. These new local repaired-source passes do not change or rerun that
provider result. No release workflow, deployment, publication, CI retry/watch,
merge, active user-run editing or later-ticket work was performed. The parent
owns revised-head CI, new independent acceptance and merge readiness.
