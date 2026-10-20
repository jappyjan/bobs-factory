# Test drive: durable recovery of stuck workflow runs

Date: 2026-10-20

Tested implementation commit: `56d37b9a9cb17a2e8b55b44065240d3fd0846441`.
Subsequent report/changelog edits do not change runtime behavior.

Driver: [assets/stuck-run-recovery.mjs](assets/stuck-run-recovery.mjs).
F1 applies because this changes role/session recovery, question waits, review
aggregation and delivery orchestration. This drive uses mocked agents and a
read-only scripted Git provider. It uses real temporary Git repositories,
worktrees, persisted checkpoints, Factory HTTP actions and activity output.
No native model, inference API, production ticket or provider merge is used.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/stuck-run-recovery.mjs
```

The committed driver creates its own repository and home. The verified run used
`/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-stuck-recovery-yj4ON6`.
Its `evidence.json` retains synthetic issue, role/resume, provider-operation and
activity evidence. Only the driver and this report are committed. The application
and Factory APIs listened on ports 3600 and 3540; the live instance was untouched.

## Assertions

| Scenario | Observed result |
| --- | --- |
| Issue intake | RPC creates the issue and starts a tracked session; the configured mocked role completes in its real worktree. |
| Unresolved architecture choice | The independent reviewer returns a concrete question and rejects the candidate. Drafting pauses after one review, with no architecture acceptance. |
| Restart, answer and acceptance | Restart preserves the question without replaying review. A guarded HTTP answer leads to a second proposal and independent review. Implementation stays blocked until the fixture submits exact-version acceptance through the normal endpoint. |
| Legacy invalid delivery checkpoint | A changed version-1 contract at the delivery gate reopens only the existing planner/reviewer route. The planner resumes `retained-planner`, corrects to version 2, and independent review confirms its digest. The original version-1 contract remains in history. |
| Invalid specialist boundary | A reviewer initially names `/progress/newHistory/7/output/comments` as a file dependency. The same role corrects to `source.txt` through the existing bounded output-correction path; exactly two mock turns run. |
| Unproven duplicate | Different evidence/remedies claiming the same original remain two actionable findings. The raw alias is retained and the aggregate stays unapproved. The fixture ends at that gate without attempting delivery. |
| Deleted clean worktree | The physical worktree is removed while its clean committed role revision and local branch survive. The runtime verifies the matching open provider revision, restores the exact branch, and completes its CI-only fixture without replaying the guide. |
| Repeated handoff after merge | A missing worktree, previously recorded exact human approval and provider-confirmed merged head reconcile through the accepted terminal merge route. The original human decision remains; no worktree is invented and no provider mutation runs. |
| Stale impact | A changed execution binding invalidates the retained assessment before selected checks. The runtime automatically returns to its declared assessor. A blocked independent result asks for access while retaining earlier work and creating no approval. No Retry is submitted. |
| Activity output | Structured result entries remain readable; their stable cursors carry valid timestamps. |

The final run printed `result: PASS`, `mode: mock`, and all nine grouped recovery
assertions. The provider operation log contains only `view`, `inspect` and
`readiness`. Both fixture servers stop in `finally`; all retained data is synthetic.

## Supporting checks and limits

During implementation, the architecture/specialist/delivery/impact/worktree/merge
suites passed 151 tests, and broader WorkflowRuntime/saved-agent/merge suites
passed 188 tests. Focused checks also passed for saved and fresh boundary
correction, delivery version correction, automatic and legacy Retry assessment
renewal, dependency escape safeguards and duplicate projection. CLI startup tests
passed 9 cases, lifecycle tests passed 5, and desktop helper/update tests passed 17.
The repository commit hook passed staged Biome checks, the full build and the full
typecheck.

Guard regressions cover changed provider/local heads, retained staged data, locked
or competing checkouts, in-flight or dirty work, path/symlink escapes, missing or
rejected approval receipts, and custom intervening/downstream steps. Recovery
refuses these cases. It preserves accepted workflow definitions, original receipts,
native conversations, exact approvals and existing correction/iteration budgets.
The handoff shortcut and committed-worktree restoration are single-repository
paths; existing grouped terminal-merge recovery retains its prior guards.

This evidence proves deterministic orchestration and real local Git recovery. It
does not establish real-model judgment, live GitHub/GitLab behavior, graphical
desktop behavior, or reconstruction of deleted uncommitted work, evidence chunks
or native transcripts. No installed binary was replaced or production run edited.
