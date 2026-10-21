# Storage retention review corrections — Taskbot #134

Date: 2026-10-20. PR: [#164](https://github.com/jappyjan/bobs-factory/pull/164).
Baseline: `f53333b38f1d201bc18d0bdf23f19bccc353d74a`. This report covers the
review corrections in this PR; the original storage-retention report remains
unchanged. Tests use isolated temporary homes and repositories, simulated agents,
controlled update lifecycles and local Git remotes. No provider credits or
production cleanup were used.

## Changed behavior and assertions

- Artifact deletion rechecks root and object identities after journal publication.
  It detaches the original tree into a private directory on the same filesystem,
  detaches and verifies each selected leaf, and removes directories only when
  empty. A durable leaf receipt supports retry after interruption. Replacement
  directories, changed content and unexpected files survive.
- Retained input/output references from every run, plus evidence symlink targets,
  prevent workspace cleanup. References are checked again under the deletion
  claim. A fixture with a stopped run in another workspace and an evidence link
  independently blocked release.
- Retained review rounds, role revisions and guides do not themselves prevent
  release. Actual file references and unfinished native continuation still do.
  Completed workflow role identities cannot Resume or Retry; Simple conversations
  remain continuable and protected.
- Historical preparation and recovery copies require an explicit election and an
  exact comparison with authoritative Factory state. Committed migration receipts
  expose only narrow `state`/`factory` preparation directories. Mixed contents,
  credentials, links, migration sources and native/external backups stay protected.
- Successful producer reconciliation records an authoritative replacement and
  releases recovery dependencies. Three subsequent snapshot copies omitted only
  the verified obsolete copy. Changed authoritative bytes revoked that exclusion.
- Rollback counting verifies the complete installed runtime and its identity.
  Missing, replaced, corrupt and unresolved linked runtime fixtures did not replace usable older
  rollback protection. Execution rechecks the protected rollback set.
- A 550-file artifact was removed after fresh verification over multiple slices.
  Previews retain their current position until verification completes. Finished
  preview cycles refresh rollback selection rather than reusing stale runtime
  availability indefinitely.
- A 105-candidate inventory, 1,200 retained runs and an ownership request held past
  one second exercised scan limits and continuation. Diagnostics stayed bounded.
- Stock Factory/Takeover delivery checkpoints were resumed through their real
  runtime graphs for manual, ticket-origin, nested and grouped fixtures. Earlier
  reviewed state was seeded; this is not a new full stock planning/review drive.
  The final delivery segment used a controlled merge handler and synthetic
  approval receipts. Cleanup preserved review records, guides and decisions.
- Actual runtime Resume restored a saved simulated native session. Its active
  durable ownership prevented cleanup. Git creation and an active UpdateManager
  staging operation also respected cleanup exclusion.
- Five update/preflight/restart cycles kept snapshot bytes at 143, 286, 286, 286
  and 286. Preparation copies expired after an eight-day clock advance. A sixth
  update injected a health failure and exercised rollback through UpdateManager;
  saved-state, authentication and native sentinels survived, with at most one
  simulated worker.
- Teardown cancellation retained the worktree. A stalled Git removal hit its
  thirty-second limit. A crash between hook effects and its success receipt
  required explicit verified idempotent retry before the hook could run again.

## Verification receipts

The review-fix evidence directory contains command logs and bounded JSON results:
`reviewfix-final-checks.json`, `reviewfix-targeted-final-checks.json`,
`security-retention-fixed-134.jsonl` and `storage-reviewfix-134.png`.

- Full build and type checks passed. Lint passed with 25 warnings in unchanged files.
- The original security reproduction, adapted to expect rejection, confirmed
  `replacementSurvives:true` and cross-run `mergeConfirmed:false`.
- Headless browser inspection confirmed the updated historical-election text and
  operation field on Settings → Storage. The screenshot was visually inspected.
- The first workspace run hit a five-second compiled-CLI test deadline and a
  one-second Resume observation deadline in MCP integration tests. It was stopped
  and restarted with bounded concurrency; the original log is retained.
- Required workspace regression passed: 3851 Vitest tests and 41 desktop tests passed; three existing optional tests were skipped. Edge worker: 2,291 passed; CLI: 235 passed; F1: 17 passed.
- Required final regression command: `pnpm -r --no-bail test:run`, with inherited
  `BOBS_FACTORY_*` variables removed, `F1_AGENT_MODE=mock`, `OPENCODE_LIVE=0`,
  `npm_config_workspace_concurrency=1` and `VITEST_MAX_WORKERS=4`. The completed
  result is recorded in `reviewfix-final-checks.json`.

## Limits

Simulated-agent checks establish orchestration and preservation, not real provider
conversation quality or cross-platform native continuation. Delivery fixtures
start from retained reviewed stock checkpoints; they do not regenerate the entire
architecture, review or human-approval sequence. No real forge merge was performed.
The desktop suite's optional pinned-Electron test remains skipped when that binary
is unavailable. Human review and provider-confirmed delivery remain downstream.
