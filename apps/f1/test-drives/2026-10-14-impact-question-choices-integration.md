# Review convergence and question-choice integration

Date: 2026-10-14. Draft PR: [#124](https://github.com/jappyjan/bobs-factory/pull/124).

Validated the merge working tree from PR head `6de167213d4a2e99dd97b634b20a9bbe022df1f6` and fetched main `9b8404e1ddce05215371c2505669483620ebe21c`, including the resolutions committed with this report. Preserved both changelog histories and the complete routing-prompt assertion. The capability reference describes main's question choices alongside this PR's impact assessment, provenance and progress safeguards.

## CI correction

GitHub run `38637959601` failed on Node 22 while deleting the operator integration fixture home (`ENOTEMPTY`). Node 24 was canceled by the matrix failure. Workflow completion status precedes final state saving; the fixture removed storage without shutting down its runtime. Every fixture now registers runtime shutdown before home removal. The earlier explanation-test shutdown registration is consolidated into that shared cleanup. All assertions remain intact. The pre-fix local focused run passed 13 tests, so the cleanup failure was not reproduced locally; the concrete CI failure and execution/final-save ordering establish the race.

## Validation

- All 75 MCP tests passed, including compiled-stdio simulated operator recovery and the failed stopped-run test.
- All 271 focused edge-worker tests passed across 11 suites, including question choices, workflow execution/recovery, impact, feedback, reader state and the complete prompt assertion.
- Monorepo build and typecheck passed. Repository Biome CI passed with 19 existing warnings. Diff checks passed.
- A fresh simulated-agent EdgeWorker drive passed both correction rounds: two impact assessments, one requirement extraction, one reused authorization review, two quality/coverage reviews, grouped repository comment assessments and immutable QA criterion provenance reuse. No human approval was fabricated. The tracker session produced its final response; worker shutdown and temporary-home removal passed.

F1 used the existing isolated impact/feedback fixture copied into a new evidence directory, with `F1_AGENT_MODE=mock`, the supported injected CLI tracker and local bare Git origin on a non-default `release` branch. Command:

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock \
  BOBS_FACTORY_FACTORY_PORT=4863 bun <evidence>/native-feedback-drive.mjs
```

Evidence is retained in this run's `ci-integration-question-choices` directory, including the original failed CI log, native results, cleanup receipt and local validation logs. Historical reports and receipts are unchanged. This drive verifies integration and retained review behavior; it does not newly validate browser behavior, real agents, remote delivery or production rollout. Fresh GitHub CI and explicit human approval of the delivered revision remain required.
