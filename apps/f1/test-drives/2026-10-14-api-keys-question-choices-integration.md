# API keys after question-choice integration

Date: 2026-10-14. Draft PR: [#117](https://github.com/jappyjan/bobs-factory/pull/117).

Tested the working merge of feature parent `5e984b89` and main `9b8404e1` before committing. The retained tested-merge.diff identifies the tested source. The conflict resolution keeps API-key access, migration and Settings guidance alongside the new question-choice contract; the complete routing-prompt expectation matches. Both changelog groups remain.

Checks passed:

- `pnpm --filter 'bobs-factory...' build`.
- Nine focused edge-worker suites: authentication, access, Questions, WorkflowRuntime, WorkflowCatalog, FactoryProvenance, FactoryPush, TicketManagers and complete routing-context prompt expectations: 224 tests.
- Terminal interface suite: 18 tests.
- Resolved TypeScript Biome checks and whitespace checks.
- With inherited Factory origins removed, `F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/tmp/choices-playwright/node_modules/playwright/index.mjs node apps/f1/test-drives/assets/question-choices-mock.mjs`: exit 0. The headless browser fixture verifies choice defaults, custom answers, explicit submission, unchanged restart receipts, stale-batch rejection and an existing-session ticket reply. Each answer resumes one simulated turn with one receipt. Browser and worker shut down.
- `F1_AGENT_MODE=mock F1_LOCAL_ACCESS_PORT=3791 F1_LOCAL_ACCESS_TLS_PORT=3792 bun run apps/f1/test-drives/assets/localhost-noauth.ts`: exit 0, all ten assertions. Covers local unauthenticated onboarding/workflow/SSE, origin restrictions, remote key login and management, revocation, restart, last-key recovery and legacy-session migration. Recorded externalRequests is empty; fixture listeners and worker shut down.

Evidence directory: `/Users/jappy/.bobs-factory/factory/evidence/manual-406599d1-26ff-477b-bb6b-bc697520ab27/merge-choices-2116`. Logs, browser captures and tested diff are retained there. The localhost fixture retained its disposable state in `/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/f1-localhost-noauth-8g4nSc`. The reported commit is the feature parent because execution preceded the merge commit.

All agents and provider responses are simulated; no real-agent credits were used. Production proxies, packaged desktop, physical mobile and real-agent suggestion quality remain unverified. Provider CI and independent review apply to the pushed merge; human approval remains required.
