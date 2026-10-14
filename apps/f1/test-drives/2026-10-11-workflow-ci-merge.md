# Workflow recovery after merging delivery changes from main

Date: 2026-10-11
Tested source revision: `bbd90d0748e06678cabad6823967a6493ddf217a`
Base revision: `73345404451f35a1cd2c13117898792dc71c5ca9`
Mode: simulated agents (`F1_AGENT_MODE=mock`)

[PR #83](https://github.com/jappyjan/bobs-factory/pull/83) had new conflicts after main adopted the delivery and update changes. The merge retains both the server's workflow Resume hooks and its update-maintenance hooks, plus both changelog entries. It introduces no new workflow requirements.

## Validation

- All 142 tests in 12 focused suites passed: factory server, update startup, catalog, chat model recovery, chat continuation, runner concurrency, native recovery, chat state, machine capacity, capacity integration, pending-work admission and update maintenance.
- The [startup checkpoint drive](assets/workflow-ci-merge-2026-10-11/checkpoint-receipt.json) passed for Slack and Zulip. Disabling during the first save starts no provider. After restart and re-enabling, individual protected HTTP Resume delivers the saved prompt and model once, posts its reply, clears the block and releases capacity. Enabling alone does not resume work.
- The [catalog drive](assets/workflow-ci-merge-2026-10-11/catalog-receipt.json) passed migration, private forks, dependency gating, blocked restart, native queue interruption, native Resume, operator manual Simple Resume and protected import/export. Established chats retain their model and native identity; missing saved identities reject recovery.
- Workspace build and type checks passed. Biome CI passed with 19 existing warnings. `pnpm audit` reported no known vulnerabilities. Conflict-resolution source whitespace checks passed. Historical raw logs and Markdown line breaks remain unchanged.
- Both drives stopped listeners and removed their disposable homes. The [validation record](assets/workflow-ci-merge-2026-10-11/validation.json) binds source, fixture and receipt digests to the tested merge commit. Committed receipts omit disposable lease/process identities; raw receipts and logs remain in the evidence directory.

## Reproduction and limits

Use the prior [checkpoint report](2026-10-10-chat-startup-checkpoint-fix.md)'s two commands for `checkpoint-cancel-chat-f1.ts` and `established-chat-f1.ts`, with fresh `F1_RECEIPT_PATH` destinations. This run's raw logs and receipts are under `/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/ci-secret-assessment`. Providers, transports and title jobs are simulated; the worker, production chat wiring, capacity, catalog and protected HTTP recovery execute normally.

At the previous head, fresh GitHub API reads confirmed both Node CI jobs succeeded and GitGuardian completed as `skipped` after the owner's explicit false-positive action for incidents 38087197–38087202. This is not a passing secrets scan or independent inspection of private incident classification. Those six values are disposable capacity lease IDs; the unchanged comment assessment and prior PR evidence remain applicable. New-head CI and review remain pending.

Real agents and live Slack/Zulip remain untested. Ticket synchronization remains unconfirmed. The PR remains draft and unmerged; human review-guide approval is still required.
