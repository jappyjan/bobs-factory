# Bundled workflows and Linear publication integration

Date: 2026-10-12. Draft [PR #83](https://github.com/jappyjan/bobs-factory/pull/83).

Integrated frozen main `c22aa72b5b428e973f2af5aade29d7f504c343a5` into tested code `cac7c130bee1a3183bb804033bdb978ce55a4d15`.
This report is a subsequent evidence-only commit. The [validation receipt](assets/workflow-linear-integration-r17/validation.json) binds source fingerprints and retained raw logs. The commit hook preserved every tested source fingerprint.

## Fixes and compatibility

Resolved all three merge conflicts. Linear publication now suppresses internal role JSON and successful tool chatter, retains raw evidence locally, and publishes validated role summaries. Accepted decision comments contain answers and rationale. Clarification and review waits use native elicitation; terminal failures use error; confirmed completion uses response. Legacy delivery presentation and uncertain-write reconciliation are retained.

The shared publication, activity manager, decision handler, ticket tracking and Linear transport match the frozen base. Capability text retains bundled ownership and private-fork instructions while adding the publication rules. Bundled catalog, default definitions, chat recovery, terminal controls and browser components are unchanged from the prior head. No new browser screenshots were required for this transport integration; prior captures remain historical evidence.

Exact frozen-base standards are byte-identical to the previously tested architecture migration source (SHA-256 `7f53325f5b43a9ece13930be8f9cb3f1f7ac847dc1fd838b34f1ef98bfea7423`). A fresh [migration probe](assets/workflow-linear-integration-r17/migration.json) with Codex model, reasoning and tier preferences retained default Factory, zero local forks, empty mappings and no conflicts.

## Executed checks

- 497 distinct tests passed: 433 worker tests, 37 additional lifecycle/incremental tests, eight presenter tests and 19 Linear transport tests. They cover publication boundaries, parallel role buffers, durable delivery/reconciliation, native lifecycle, architecture, pipeline, saved-run recovery, catalog, specialist review and complete routing prompts.
- Workspace build and type checks passed, including the required commit hook. Repository lint passed with 19 existing warnings. Whitespace and conflict-marker checks passed.
- Three relevant F1 drives passed with simulated agents in disposable homes/repositories. No provider credits or production tracker writes were used.

```sh
python3 <evidence>/qa-f53d9afc/qa-clean-run.py pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-publication-101.ts"
python3 <evidence>/qa-f53d9afc/qa-clean-run.py bun run apps/f1/test-drives/assets/run-workflow-catalog-129.mjs
python3 <evidence>/qa-f53d9afc/qa-clean-run.py bun run apps/f1/test-drives/media/2026-10-11-architecture-decision-brief/f1-drive.ts
```

Linear F1 used the real SDK against local simulated GraphQL. It verified one explicit decision comment, ten modeled native lifecycle comments, zero routine progress comments, all four modeled provider states, auth/select signals, nested/parallel outcomes, one completion response, zero restart duplicates and zero unhandled rejections. Real provider rendering was not exercised.

Catalog F1 passed seven groups: migration/preferences and reserved Simple, private-fork isolation and dependency gating, incompatible native settings, interruption and retained conversation Resume, retained attachments and missing-repository rejection, restart without automatic continuation, individual operator Resume, and export/import. The log includes expected simulated cancellation during the deliberate interruption.

Architecture F1 passed five scenarios. Private Factory and Takeover copies preserve discussion and restart, reject open/stale acceptance, regenerate three proposal versions and start implementation exactly once after exact acceptance. Routine work bypasses the extra wait; a revision missing its change description fails safely. The fixture deliberately ends after implementation, before real publication.

## Remaining limits

Reviewer reassessment, downstream CI/QA, whole-PR brief regeneration and explicit human approval remain due. PR #83 remains draft and unmerged. No deployment occurred. Real agents, live tracker/chat services and packaged desktop behavior were not retested. Ticket synchronization and private GitGuardian incident closure remain unconfirmed. Customized legacy Simple stays backed up and recoverably blocked. Historical chats without a saved model use current defaults; uncertain recovery without a conversation ID stays blocked.
