# Repository-scoped approval freshness

Date: 2026-10-26. Taskbot #158 / PR #202.

Tested source: the review fix rebased onto `origin/main` at `9a8bf551`
(including #200, #203 and #205), committed with this report. `NodeGuarantees.ts` SHA-256:
`c3a9c297e901da69cea014f6a40face3d664d8a31b89bfa8705804abdfa3f508`.

## Scenario

A `nodes-v1` recipe runs a scripted review agent, a bound interactive Display,
then a Check containing `fresh(approval)`. Each case uses a new temporary real
Git repository with `a/` and `b/`, an isolated Factory home and the authenticated
Factory API fixture. No live inference or provider calls are used.

The four cases combine producer scopes `{paths: ["a/**"]}` and `"none"` with
an unset or explicit `"repository"` approval scope.

## Command and results

```sh
pnpm --filter ./packages/edge-worker test:run test/NodeGuaranteesF1.test.ts
```

All five tests passed: the existing scoped-reuse drive plus four approval cases.
The existing response-scoping drive now explicitly declares its intended path
scope; an unset scope means the whole repository.

Each new case asserts:

1. Before the human wait, the visit stamp contains its own HEAD and workspace
   digest, alongside the original bound producer's revision checks.
2. A dirty edit to `b/` during the wait survives a cold runtime restart without
   replacing the accepted visit stamp.
3. The resumed Display accepts an explicit answer through the authenticated
   `/api/runs/:id/view-answer` endpoint. The following Check returns
   `{passed: false, current: false}`.
4. The producer remains fresh, while the approval is stale. Restoring the
   workspace makes the approval fresh again.
5. A subsequent commit touching only `b/` makes the approval stale, with the
   producer still fresh and the approval retaining its original HEAD.

All servers, runtimes and temporary repositories are cleaned up. These are
scripted orchestration/API checks with real Git, not native-agent or remote merge
provider validation. A merge provider must still enforce the approved head.

The rebase retains the common async node context in retry backoff and Wait
polling, and supplies the freshness resolver to both pure and legacy Check
execution paths. Mutating-agent revision stamping is also checked for both
legacy recipes and `engineVersion: "nodes-v1"`.

Integrated validation after #203: all 395 tests passed across 14 suites,
including the original focused runtime suites plus FactoryLogicFlow,
ProgressBudget and WorkflowCatalog. Edge-worker build and typecheck passed.
