# Architecture approval continuation

Date: 2026-10-18. Tested implementation: `0e837003` (the final fixture assertion
also validates activity content and timestamps). Base: `3843f3bd`.

F1 applies to the changed architecture approval and conversation lifecycle. All
roles use `MockAgentRunner`; no provider inference or external tracker was used.
The fixture uses a private home, injected in-memory tracker, Git repository and
worktree, localhost webhook/RPC port 3600 and dashboard port 3541.

## Reproduction

Reported run `2ad6cfda-7c11-41b4-a700-03137ec1e5a8` had 24 proposals and nine
explicit acceptances. Its latest revision only added two necessary authorization
test files and expressly retained production interfaces. Its frozen workflow
treated the file manifest as exhaustive and had no independently reviewed route
to continue an existing architecture approval. The new regression first failed
because the review contract rejected the continuation receipt.

## Assertions and results

The drive starts through issue creation and session assignment in the actual
EdgeWorker, then uses the protected dashboard API for approval and answers.

- Initial meaningful architecture waits before any implementation executes.
- Two successive independently reviewed caller-test revisions link to the same
  exact human acceptance; three proposals require one acceptance. The runtime
  records continuity separately rather than adding fabricated human decisions.
- Worker shutdown/restart retains accepted definitions, the original decision,
  proposal digests and continuation link. Answering the restored implementation
  wait resumes its same mock native conversation.
- A subsequent external-interface change has no continuity assessment and waits
  at proposal version 4. Only acceptance of that version starts final implementation.
- The fixture completes, creates and inspects its caller coverage file, verifies
  five implementation visits, reads nonempty timestamped tracker activities, and
  stops the worker cleanly.

Unit/runtime checks separately cover omitted/stale continuity, revoked acceptance,
open decisions, saved workflows without opt-in and `approval: always`. Existing
asset-integrity, stale acceptance and restart tests also pass.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter bobs-factory-edge-worker test:run test/Architecture.test.ts \
  test/WorkflowCatalog.test.ts test/WorkflowRuntime.test.ts \
  test/WorkflowExecution.test.ts --maxWorkers=1
pnpm typecheck
pnpm lint
node --test scripts/tests/nightly-baseline.test.mjs
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/architecture-approval-continuation.mjs
git diff --check
```

166 focused tests and the nightly baseline check passed; build, types and lint
passed (22 existing lint warnings). The final F1 run passed. Its result and private
home are retained at
`/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-architecture-continuation-lUnLQo`;
the execution log is `/tmp/architecture-continuation-f1-final.log`.
Earlier fixture attempts exposed a startup race and Bun accessor comparison in
the test driver; both were corrected before the final successful drive.

The scenario is also included in nightly checks with its log inventoried in the
candidate-bound receipt. This proves controlled orchestration, persistence and
approval boundaries. It does not establish live model judgment or repair the
production run; that run retains its graph and needs normal operator direction.
