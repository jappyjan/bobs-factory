# Storage retention CI corrections — Taskbot #134

Date: 2026-10-20. PR: [#164](https://github.com/jappyjan/bobs-factory/pull/164).
Tested source: `2aef11e4f9900153edd0743b687cfb6f40c72e87`, incorporating target
`121ebe302f869c1cfce36560904953d0c2233970`. Historical reports are unchanged.

## Changed behavior and assertions

- Migration retry completes interrupted enrollment after initialization,
  registration, integrity publication and replacement reconciliation. It reuses
  identity-verified records instead of registering duplicates. Separate negative
  cases retain changed authoritative or preparation data and refuse replay.
  All 57 migration tests passed within the CLI suite.
- Saved build output in current outputs, history and frozen review context no
  longer prevents delivered-workspace cleanup when it matches runtime-owned
  impact receipts. Snapshot identity exemptions use recorded runtime snapshots
  and exact repository workspace identities. Arbitrary repository-shaped output,
  exact workspace references outside those locations and forged descendant
  identities still prevent release.
- The five manual, ticket, nested, grouped and Takeover delivery fixtures now
  retain command receipts. They verify cleanup while preserving cross-run file,
  historical-output and evidence-symlink dependencies. They start from retained
  reviewed checkpoints and use controlled local delivery, not a new real review
  or human approval.
- All eight storage-retention F1 scenarios passed, including simulated native
  continuation, actual Resume/deletion exclusion and five update cycles. The
  complete F1 package passed all 17 tests with simulated agents.

## Validation

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-9a020f41-9844-4a38-b17b-977a1ed1973d/`.

- `ci-fix-r3-build.log`, `ci-fix-r3-types.log`: build and typecheck passed.
- `ci-fix-r3-biome.log`: passed with 30 non-fatal warnings.
- `ci-fix-r3-install-guards.log`: 175 installation/publication safeguards passed.
- `ci-fix-r3-selected-check.json`, `ci-fix-r3-workspace.log`: the declared
  sanitized workspace command ran through production FactoryTools and
  selectedChecks with a twenty-minute deadline. Source remained clean and
  unchanged. It completed in 366.949 seconds with one failure in the Codex
  cancellation fixture's one-second child-readiness wait. All other packages
  passed, including 2,300 edge-worker tests, 242 CLI tests, 17 F1 tests and 41
  desktop tests. Three optional tests were skipped.
- The follow-up changes only that fixture's readiness wait to five seconds,
  this report and the internal changelog. Cancellation and process-exit assertions
  remain intact. `ci-fix-r3-codex.log` records all 140 Codex tests passing after
  correction. The complete workspace command has not been repeated after this
  test-only correction; its original failure is retained.

## Managed-check blocker and limits

`ci-fix-r3-runtime-timeout.json` records the installed runtime and source evidence.
The agent's parent is the installed Bob's Factory executable; its build manifest
identifies commit `3f7d901aedfc59c2d527df7ee3aa3d3e24b453a7`. That revision explicitly
passes **120000 ms** to selected checks. The worktree's implementation passes
**1200000 ms**. Changing a checkout cannot change the compiled running process.
An owner must update/restart the installed runtime before the managed independent
workspace check can use the corrected deadline. The local replay neither edits
that gate nor supplies its missing independent receipt.

No real provider inference, production cleanup or forge merge was used. Real
provider continuation and native behavior on other platforms remain unverified.
These backend corrections do not establish downstream Storage UI QA, human
acceptance or delivery. Fresh review remains required.
