# API-key QA: explicit fixture trackers

Tested on 2026-10-14 against `e3e8f80923a1a09fd4326dea8c74b25d0c9f0a1f`
with the fixture changes in this commit. Product runtime and UI sources are unchanged.

## Corrections

Both embedded fixtures still supplied the retired `platform: "cli"` setting.
Unified startup selects tracker dependencies through `issueTrackerFactory`.
Without that injection, onboarding did not register `/cli/rpc` and local-access
validation constructed a real Linear tracker whose SDK transport bypassed the
global fetch guard. Both fixtures now inject `createCLIIssueTracker`, matching
the maintained F1 server. Onboarding also simulates the public Linear webhook
IP metadata response, as the local-access fixture already did.

The previous accepted-output and timeline assertions remain intact. The earlier
report's no-provider-call claim is superseded by the second QA round's observed
Linear metadata requests; this report covers the corrected fixtures only.

## Executed checks

```sh
F1_AGENT_MODE=mock F1_ONBOARDING_PORT=3650 bun run apps/f1/test-drives/assets/simple-install-onboarding.ts
F1_AGENT_MODE=mock F1_LOCAL_ACCESS_PORT=3631 F1_LOCAL_ACCESS_TLS_PORT=3632 bun run apps/f1/test-drives/assets/localhost-noauth.ts
pnpm exec biome check apps/f1/test-drives/assets/localhost-noauth.ts apps/f1/test-drives/assets/simple-install-onboarding.ts
git diff --check
```

Both final fixture executions exited 0. Onboarding reached issue creation,
repository/worktree selection, simulated agent output, Factory activity,
CLI timeline pagination, local Git commit/push, simulated draft/readiness,
stale-approval refusal and exact-head simulated merge. It stopped its worker
and removed its successful disposable fixture home.

All ten local-access check groups passed, covering credential-free loopback
access, onboarding, scripts/worktrees, forged request rejection, TLS key login
and management, session revocation, restart, last-key recovery, legacy migration
and SSE. Its listeners and worker stopped; its disposable home and result receipt
remain available as evidence.

Final logs contain no Linear authentication errors or rejected controlled
transport requests. Tracker operations use the injected in-memory implementation;
GitHub API and webhook metadata responses are simulated. No native agents or
model inference ran. Formatting and whitespace checks passed.

Runtime evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-406599d1-26ff-477b-bb6b-bc697520ab27`

- `fix-r2-onboarding-final.log`: final passing onboarding execution.
- `fix-r2-local-access.log`: passing local/remote API-key execution and receipt.
- `fix-r2-onboarding.log`: initial passing onboarding run, before adding the
  simulated webhook metadata response; its blocked fetch warning prompted that correction.

## Limits

This fix changes test fixtures only. Previously accepted screenshots are retained.
No new browser capture was needed. Real providers, production proxies, packaged
desktop and physical mobile/PWA behavior remain unverified. Independent review,
CI and QA reassessment still apply; PR #117 remains draft.
