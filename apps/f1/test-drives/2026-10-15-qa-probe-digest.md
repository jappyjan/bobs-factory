# QA environment probe digest compatibility

Date: 2026-10-15. Tested `e9ec4f91` plus the QA probe compatibility fix.

## Reproduction

The manual run “Hide model selection for non-simple workflows” repeatedly failed
at `pipeline/capture`. Its saved environment probe still produced exactly the
declared SHA-256, `25a2fa1c0b1fdc342be7fdd503442fe65d22c716596de8a172e1f0ada80e1bb5`.
The runtime hashed JSON-quoted stdout instead, falsely reporting changed fixtures.
The focused regression failed before the fix. Read-only execution of the saved
probe passed with the corrected verifier; no run state or installed binary changed.

## F1 validation

F1 applies to the Factory QA capture lifecycle. An isolated CLI-platform EdgeWorker
used a disposable Git repository, home and worktrees, with Factory on port 3698
and its shared server on 3699. All role and title runners were MockAgentRunner;
no native provider or inference API ran. Manual launches exercised a custom
`visual-scope → capture` workflow with the real `qa-v1` startup probe and capture
finalization path.

- Standard SHA-256 of trimmed stdout: completed; capture runner invoked.
- Legacy JSON-string digest: completed; capture runner invoked.
- Changed fixture output with the original expected hash: failed with the fixture
  change error; capture runner never invoked.
- Run events included the capture step in all three scenarios. The worker shut
  down and the disposable home, repository and worktrees were removed.

Command executed: `F1_AGENT_MODE=mock bun run apps/f1/.qa-probe-drive.ts`.
The temporary driver was removed from the checkout; a copy with absolute imports
is retained at `/tmp/bobs-factory-qa-probe-f1.ts`. Log and scenario receipts:
`/tmp/bobs-factory-qa-probe-f1.log` (`F1_QA_PROBE_RESULTS`). The first fixture attempt
omitted required capture fields and was corrected before the passing drive.

## Other checks and limits

- `pnpm --filter bobs-factory-edge-worker exec vitest run test/Impact.test.ts`:
  all 16 tests passed, including compatibility, output trimming, changed-fixture
  rejection, proof clearing and existing behavioral provenance/reuse coverage.
- `pnpm --filter bobs-factory-edge-worker typecheck`: passed.
- Targeted Biome checks and `git diff --check`: passed.

This validates mocked orchestration and probe identity, without claiming browser
QA, native provider execution, deployment or recovery of the live run.

## Nightly payload assessment

PR [#139](https://github.com/jappyjan/bobs-factory/pull/139) was rebased onto
`44832ee7`, the exact source of the previous published nightly
`v1.0.0-nightly.20261015.38774231819`. The complete payload since that release is
this QA digest correction, its scope instructions, regression and documentation;
there are no dependency, native runtime, license or migration changes.

The same three-scenario drive passed again on rebased fix commit `11d328e` using
`F1_AGENT_MODE=mock bun run /tmp/bobs-factory-qa-probe-f1.ts`; receipts are in
`/tmp/bobs-factory-qa-probe-f1-rebased.log`. Repository build and typecheck hooks
also passed after rebasing. This covers the changed capture workflow; the nightly
pipeline still requires fresh candidate-bound native/desktop validation and its
current full-payload mocked checks before publication.
