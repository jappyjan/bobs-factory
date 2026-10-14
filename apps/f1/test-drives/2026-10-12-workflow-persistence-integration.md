# Bundled workflows with chunked persistence and resumed history

Date: 2026-10-12. Draft [PR #83](https://github.com/jappyjan/bobs-factory/pull/83).

Integrated main `8baccedc31f5816a51eae6399225678b81223dc0` with branch parent `d5a61b1e7c451e718b99966104f647c296d56d4e`. The [receipt](assets/workflow-persistence-integration/validation.json) records the tested staged tree and source hashes before this report was added. Historical evidence remains unchanged.

## Resolved conflicts

Retained both changelog histories. Dashboard lists use cached history summaries and include current workflow blocks and status, including after restart. Saved graph definitions remain frozen; execution still checks availability and now awaits the initial disk checkpoint. Loaded completed receipts and event pages use main's immutable chunk storage. Local graph fixtures retain editable copies rather than modifying bundled standards. Catalog fixtures await persistence before reload and cleanup; the F1 driver compares every serialized history field despite the immutable objects' different prototypes.

Main's nightly artifact and release changes are retained. No release was published.

## Executed validation

- Workspace build and type checks passed.
- 372 worker tests passed across 14 selected suites, covering catalog, graph persistence, pipeline, API, native recovery, background admission, architecture, review, CI supervision and delivery tracking. All 32 selected core storage tests passed. The catalog suite passed its 18 tests again after adding dashboard block assertions; these are included in the 372, not additional distinct tests.
- `node --test scripts/tests/*.test.mjs` passed with exit 0, including the delayed desktop-receipt check and new nightly transport coverage.
- `F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/run-workflow-catalog-129.mjs` passed migration/preferences, private forks, dependency gating, interruption, restart without automatic continuation, retained native conversation/attachments, individual operator Resume and export/import. A headless browser screenshot verified the blocked run's saved question and disabled Resume while its workflow is disabled.
- The maintained persistence driver passed with simulated agents and a controlled script. It exercised real CLI RPC, EdgeWorker, HTTP dashboard, disk restart, immutable loaded history, legacy byte preservation and one explicit answer through completion. Its logical transcript was 1 GiB of repeated strings, not 1 GiB of unique writes. During saves, 565 HTTP requests had p99 2.79 ms and maximum 4.66 ms. The short append wrote 2,581 payload bytes; maximum state capture was 0.82 ms. Whole-drive event-loop delay reached 1.70 seconds and includes setup and history reads.

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx ../../apps/f1/test-drives/assets/persistence-responsiveness.ts
```

Both F1 commands ran with inherited Factory credentials and repository scope removed by the retained clean-run wrappers. Raw logs and the inspected screenshot are in `/Users/jappy/.bobs-factory/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/ci-persistence-merge/`.

The first catalog drive found a prototype-only assertion mismatch and passed after comparing complete JSON data. The first large-history drive reached final result persistence but exceeded its 30-second completion wait under parallel validation. Its failed home and log were retained. The unchanged isolated rerun passed without extending deadlines or removing assertions.

## Remaining limits

Real agents, production tracker/chat delivery and storage hardware failures were not exercised. Version 5 persistence requires the complete home and compatible backup for downgrade. Customized legacy Simple stays backed up and blocked; historical chats without saved models use current defaults, and uncertain conversation recovery stays blocked. Fresh provider CI, reviewer reassessment, whole-PR guide regeneration and explicit human approval remain downstream. PR stays draft and unmerged; ticket synchronization and private GitGuardian incident closure remain unconfirmed.
