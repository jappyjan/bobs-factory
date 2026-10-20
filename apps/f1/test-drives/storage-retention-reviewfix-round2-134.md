# Storage retention review corrections, second round — Taskbot #134

Date: 2026-10-20. PR: [#164](https://github.com/jappyjan/bobs-factory/pull/164).
Reviewed baseline: `2bed21b24fdfdfb6685a5f9e839a57c401746470`.
Original reports remain unchanged. All homes, repositories, agents and delivery
receipts are isolated fixtures. Agents are simulated; no provider credits,
production cleanup or forge merge are used.

## Assertions

- A verification failure after leaf detachment preserves both changed original
  bytes in quarantine and a concurrent replacement at the original leaf name.
  Recovery uses exclusive hard-link creation instead of overwriting a file.
- Workspace references saved only in another run's history prevent release.
  Other retained content fields receive bounded inspection. Standard repository
  workspace metadata in impact snapshots and frozen review context permits
  release, while actual file and symlink dependencies remain protected.
- Every grouped parent entry is inspected before teardown. A later unexpected
  file retains both delivered members, and no hook executes.
- New migration producers register narrow state/factory preparation directories
  under shared claims. Verified authoritative replacements release dependencies.
  The migration regression advances the age by eight days, removes eligible
  preparation and preserves authoritative state, the source and its backup.
  Recovery refuses an active cleanup claim on enrolled preparation, including
  when migration and recovery use a symlink alias for the backup path.
- The real cleanup coordinator enters a controlled deletion barrier while holding
  its claim. Actual runtime Resume fails admission before starting an agent.
  Interrupting the controlled deletion preserves native files; explicit Resume
  then continues the saved simulated session. Eligibility and the destructive
  adapter are controlled in this race fixture to isolate the claim boundary.
- A real 1,100-file inventory crosses the 1,000-entry slice boundary, resumes and
  measures every file. Every returned slice stays within its entry budget.
- A real hanging teardown expires at the two-minute limit, cancels its process
  and retains the Git worktree. The existing thirty-second Git timeout also runs.
- Independent selected commands now use the standard twenty-minute deadline.
  The old hard-coded two-minute deadline could not accommodate the required
  workspace regression. The grouped impact test checks the supplied deadline.

## Commands and receipts

Focused storage tests: 34 passed. Migration tests: 60 passed. Build, workspace
type checks and Biome are also executed. Final F1, impact and workspace results
are retained with the exact revision in the run evidence directory:

`/Users/jappy/.bobs-factory/factory/evidence/manual-9a020f41-9844-4a38-b17b-977a1ed1973d/`

- `reviewfix-r2-storage.log`, `reviewfix-r2-migration.log`
- `reviewfix-r2-f1.log`, `reviewfix-r2-resume.log`, `reviewfix-r2-impact.log`
- `reviewfix-r2-build.log`, `reviewfix-r2-all-types.log`, `reviewfix-r2-lint.log`
- `reviewfix-r2-selected-check.json`, `reviewfix-r2-workspace.log`

An initial workspace replay at `10c56943` was interrupted after inspection found
a backup-alias claim mismatch. Its superseded log is retained. The final receipt
binds the corrected committed source. A replay at `64735f34` then exposed existing
one-second ticket-recovery polling deadlines. An isolated reproduction failed
those waits; the same four checks passed with the existing five-second runtime
helper, taking 1.1–1.9 seconds each. The publication promise remains blocked, so
completion still proves that publication does not hold execution. The known-failed
full replay was stopped and retained before the final restart.

The workspace command is replayed through production `FactoryTools.tool` and
`selectedChecks`, using the independently selected declaration from this run.
The replay writes a separate receipt; it does not edit the managed run's gate or
claim that reviewer reassessment has occurred. It removes inherited
`BOBS_FACTORY_*` settings and uses `F1_AGENT_MODE=mock`, `OPENCODE_LIVE=0`,
`npm_config_workspace_concurrency=1`, and `VITEST_MAX_WORKERS=4`.

## Limits

Stock delivery scenarios start from retained reviewed checkpoints and use
controlled delivery. They do not regenerate planning, architecture acceptance or
human approval. Real-provider continuation and native cross-platform behavior
remain unverified. The correction changes backend behavior; the prior inspected
Storage screenshot remains the UI evidence. Independent reassessment, later QA,
human approval and provider-confirmed delivery remain separate workflow steps.
