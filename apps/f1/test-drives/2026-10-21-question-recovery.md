# Recheck saved assistance without inventing an answer

**Date:** 2026-10-21 (Europe/Athens)
**Production replay and mocked F1 drive:** PASS.
**Mode:** scripted production-snapshot replay and deterministic mocked agents.
**Base:** `9a5d28d6b01f86fd25c23e9ccaa8d32707b0f910`.

The change affects saved runner conversations, assistance checkpoints and bounded
impact correction, so relevant F1 validation is required. This report records the
production replay; the related mocked EdgeWorker drive exercises the HTTP action
and subsequent workflow gates.

## Recorded failure

Several assistance requests predated the running nightly. Restart preserved their
saved questions and completed turn results, so installing a runtime correction
did not reassess whether the original blocker still existed. Supplying a made-up
answer would also misrepresent unresolved scope decisions as human direction.

One captured impact assessment required source corrections. Two subsequent fixer
visits skipped correction when a provider failure cleared. The independent
assessor correctly kept the source obligations open; the convergence guard then
asked for help after three unchanged assessments. The prior nightly already fixes
that skipped-fixer cause. A separate recovery defect remained: re-evaluating the
blocked assessment immediately produced the same engine question at repeat four,
before the corrected fixer could execute. This failure was reproduced against the
captured production decision with the original compiled convergence function.

## Isolated production replay

```sh
bun apps/f1/test-drives/assets/question-recovery-production-replay.ts \
  <private-production-clone> <owned-launch-asset-store>
```

The capture contains six run manifests, 18,237 immutable content chunks totaling
1,063,323,490 bytes, four saved assistance waits and two running checkpoints.
The replay creates a second disposable working home, copies manifests, and
hardlinks immutable chunks.
Snapshot writes create temporary files and replace only working-directory entries;
the original capture is verified again after execution.

All active repository bindings are redirected to an independent disposable Git
repository with no remotes. The single referenced launch attachment and its owned
manifest are copied read-only from the supplied asset store, with size and SHA-256
verification. The normal `LaunchAssetStore.verify` contract runs unchanged.
Configuration and credential stores are excluded. No native runner, inference
request, provider command, push, production-state write or installation occurs.

Assertions against the four actual saved waits:

- Restoring the waiting checkpoint executes no agent and retains the questions.
- Only the exact current step and question batch can request a recheck; a stale
  batch is rejected before any role executes.
- Recheck discards the completed turn cache and retains the saved native
  identity. All four scripted agent hooks receive their original conversation
  identity once.
- The impact preflight recomputes its snapshot against the disposable repository.
  The scripted impact role receives this newly computed context; the
  replay does not relabel the old private-repository snapshot as current evidence.
- Every scripted role returns a concrete unresolved assistance request. A new
  question batch is displayed, and later workflow gates remain untraversed.
- The explicit recheck receipt is persisted with the new history entry. Original
  history pages, accepted workflow definitions, answers, architecture decisions
  and human delivery decisions remain unchanged. The role receives one additional
  visit, within its existing allowance.
- The two captured running checkpoints are loaded but never launched.

The actual captured convergence decision is also replayed independently. An exact
acknowledgment of its saved key, snapshot digest and decision timestamp permits
one completed corrective assessment while retaining the existing repeat-three
counter. After saving that assessment, another unchanged evaluation asks for help
at repeat four. Wrong or superseded bindings cannot reuse the acknowledgment.
Concrete assessor questions and failed assessments retain their own results.

## Mocked EdgeWorker drive

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/workflow-stall-recovery.mjs
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/impact-feedback-recovery.mjs
```

The extended drive starts a real local `EdgeWorker` with deterministic agent and
provider hooks, creates its test issue and session, and verifies observable
activities. It passed these changed-behavior assertions:

- After a worker restart, the HTTP recheck action rejects a stale question batch,
  then resumes the exact current fixer conversation once. No fabricated answer or
  human approval is added, and its unresolved finding remains actionable.
- A fixer requests architecture revision in a recipe with renamed proposal and
  review roles. The runtime routes through the accepted recipe rather than
  assuming stock role names. Five scripted role visits reach version two of the
  independently reviewed proposal and stop for fresh acceptance.
- The obsolete version-one acceptance is rejected. The current version remains
  pending, accepted source history remains retained, and the unresolved finding
  is not falsely marked fixed or rejected.
- Existing incomplete-review recovery, doubled stock allowances, retained extra
  passes, restart idempotence and live-target CI assertions continue to pass.

The local server shuts down cleanly. The receipt records all 15 assertions as true
and contains the scripted turn order and provider-request inventory.

The existing impact-feedback drive also passes against the rebuilt candidate.
Fresh feedback is corrected in its original conversation; a saved result recovers
after restart and Retry; both self-referencing inventories pass selected checks;
explicit human acceptance remains required. Both drives were repeated after the
crash-boundary fix.

## Verification and limits

The focused impact checks cover bounded re-evaluation, rejection of unrelated or
superseded acknowledgments, changed source state, and preservation of real
assistance questions. A crash-boundary regression captures every snapshot after
the one-shot acknowledgment is consumed. Each contains the completed role phase
and matching decision, output and history receipt; an intermediate executing
checkpoint cannot consume the acknowledgment before its result is committed.
The production replay passed again after this fix. It deliberately uses scripted
`RuntimeHooks` and stops at fresh assistance. It establishes checkpoint recovery
and retained evidence; it does not claim target-repository corrections, native
provider behavior, completed independent review, QA or human approval.

The final edge-worker suite passed all 171 test files: 2,318 tests passed and one
was skipped. Complete prompt-assembly expectations passed all five checks. The
related operator MCP integration checks passed 14 tests, and TUI checks passed 20.

The exact uncommitted candidate tested before PR creation was:

| Source | SHA-256 |
| --- | --- |
| `WorkflowRuntime.ts` | `c7516590c72b106dd016638dd515838eb872e489bd1483fc8216a8190fe8ca14` |
| `Impact.ts` | `b5bacb5624bc65823c45c11e73d523c6a0f7a1386c36ca27bda1e2bcf75b572a` |
| `question-recovery-production-replay.ts` | `db58a817df10ad4a613ebac90c88fe327cfe01913fd7ccf5ad005db5243d776f` |
| `workflow-stall-recovery.mjs` | `775dde37cf21411b527948a6acd2cb152154f0b6ea7a4db9065d038690d4d232` |
| `impact-feedback-recovery.mjs` | `7f1509c7d39fd715309eaab1b49ce193da16537e7c5e09cd6c6fd7a5fa4bd4a4` |
| Compiled `WorkflowRuntime.js` used by F1 | `d4960f91fd65b410b34b7011601619aeee1f8e8841001fcc3892417c23ebeaa1` |
| Compiled `Impact.js` used by F1 | `e473d9eb7b758b7f50a3a752f7b1053c19ab5f9065edaa9a340444f5fb65e613` |

The production replay prints its source hashes with the sanitized result. Raw
production snapshots, attachments and transcripts remain outside the repository.
Historical test-drive evidence is preserved.
