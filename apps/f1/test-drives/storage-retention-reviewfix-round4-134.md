# Storage retention: saved references and interrupted publication

Date: 2026-10-21. PR: [#164](https://github.com/jappyjan/bobs-factory/pull/164).
Source: the commit containing this report, based on `9aacc180`.
Earlier reports and failed receipts remain unchanged.

## Changed behavior and assertions

Workspace inspection now enrolls historical metadata separately for each owning
run. It resolves assessment and check-tool locations through the run's accepted
workflow, including called workflows. Assessment copies must match the enrolled
snapshot and timestamp; command receipts must match exactly. Current outputs,
step history, frozen review copies and retained checkpoint outputs are supported.
Registration work yields within the existing inspection budget. Runs without
impact decisions do not need a workflow traversal.

The delivered-workspace regression now includes assessment receipts, check-tool
outputs and their history/frozen copies. It confirms eligible cleanup through
manual, ticket, nested, grouped and Takeover routes while preserving saved output.
Copied snapshots with an exact workspace-root reference, complete copied impact
records and copied command receipts protect their content in arbitrary output.
Copies in another run remain dependencies even under a real workflow step name.
Existing file references, historical references, evidence symlinks, unfinished
native sessions and Resume exclusion remain covered.

Ownership publication saves its intended registration or revision before writing
the record and indexes. Producer retry validates directory identity, the record,
path index, inventory pages and count under the inventory claim. Only matching
partial writes are completed. Conflicting records, indexes, pages, counts or
identities retain the unfinished marker and data. Unknown intents fail closed.
Migration retries recover publication before resuming enrollment.

## Executed focused checks

- `pnpm --filter bobs-factory-core exec vitest run test/StorageRetention.test.ts`:
  **15 passed**, including interruptions before each registration write and final
  completion, interrupted revision recovery, and rejection of conflicting state.
- `pnpm --filter bobs-factory exec vitest run src/migration/migration.test.ts`:
  **62 passed**. Five added cases interrupt inside publication, retry twice,
  confirm one inventory entry, expire preparation and preserve authoritative,
  original-source and backup-source sentinels.
- `F1_AGENT_MODE=mock pnpm --filter bobs-factory-f1 exec vitest run test/storage-retention.test.ts`:
  **8 passed** in the final focused run. The five-cycle fixture retained bounded
  rollback storage and all existing lifecycle assertions.

An intermediate budgeted-policy implementation traversed workflows unnecessarily
for 1,200 runs without impact decisions. The unchanged 40-slice assertion caught
that overhead. Skipping unnecessary enrollment fixed it; the final eight-scenario
run passed without weakening the budget assertion. The earlier failed log remains.

Focused logs and source fingerprints are in the supplied evidence directory:
`reviewfix-r4-core.log`, `reviewfix-r4-f1.log`,
`reviewfix-r4-f1-final.log` and `reviewfix-r4-focused.json`.
Workspace build/type checks run through the required commit hooks; broader
regression results are retained separately in `reviewfix-r4-workspace.json` and
`reviewfix-r4-workspace.log`.

## Evidence limits

F1 uses simulated agents, isolated homes and real local Git with controlled
provider delivery proof. Stock delivery scenarios resume retained reviewed
checkpoints. They do not establish real-provider continuation, a fresh stock plan
or human approval. This correction changes no UI; later Storage UI QA,
independent reassessment, human acceptance and provider delivery remain their
own workflow obligations.
