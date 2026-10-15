# Impact review and ticket-manager integration

Date: 2026-10-14. PR: [#124](https://github.com/jappyjan/bobs-factory/pull/124).

Validated PR head `64f71cd4d19da563cc5ec14cf822a8ae354e1f95` combined with fetched main `bb024b6ff9e857efdd06c7b54a91a94249146c88` before committing the integration. Conflicts were limited to changelog entries, the capability reference and its complete routing-prompt expectation. Both descriptions and the complete assertion are preserved. The automatic merges retain impact validation, capture provenance and protected reader progress alongside unified startup and ticket-manager settings.

## Simulated-agent integration

Applied the canonical F1 protocol to the existing isolated impact/feedback fixture. A new copy explicitly injects `createCLIIssueTracker()` through `issueTrackerFactory`, as required by unified startup. Historical evidence is unchanged. All provider/background runners are injected simulated agents; no paid agents or remote delivery are exercised.

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock \
  BOBS_FACTORY_FACTORY_PORT=4863 bun <evidence>/native-feedback-drive.mjs
```

The fresh temporary repository targets `release` with a local bare origin. The actual compiled EdgeWorker, protected manual-run API, CLI tracker listener, worktree creation and workflow runtime execute the complete two-round scenario. Assertions passed for:

- Two independent impact assessments, one inventory extraction, one authorization review, and two affected quality/coverage reviews.
- Grouped comment IDs `a:42` and `b:42`, bound to their distinct repositories.
- Both QA gates passing, with original criterion provenance preserved through explicit reuse.
- Original authorization review reuse and absence of any human approval.

The originating fixture session emitted its final response activity. Worker shutdown and temporary-home removal passed. Evidence is retained in this run's `ci-integration-ticket-managers` directory: `native-feedback-drive.mjs`, `native-results.json`, `cleanup.json` and validation logs.

This validates integration using simulated agents and local providers. Real-model judgment, real remote delivery and browser behavior are not newly validated by this drive. Fresh GitHub CI and human delivery approval remain required.

## Local checks

- `pnpm build` and `pnpm typecheck`: passed across the monorepo.
- `F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts test/FactoryReviewState.test.ts test/FactoryWebClient.test.ts test/WorkflowRuntime.test.ts test/WorkflowExecution.test.ts test/WorkflowCatalog.test.ts test/WorkflowNativeRecovery.test.ts test/MergeReadiness.test.ts test/TicketManagers.test.ts test/prompt-assembly.routing-context.test.ts`: 241 tests passed in 10 suites.
- `pnpm exec biome check packages/edge-worker/src/factory/Workflow.ts packages/edge-worker/test/prompt-assembly.routing-context.test.ts`: passed.
- `git diff --cached --check`: passed; no unresolved files remain.
