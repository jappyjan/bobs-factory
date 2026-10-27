# Release-fixture cutover audit

Date: 2026-10-27. Base: `2673a81c`. Controlled agents/providers only.

## Reproduction and scope

Fresh candidate `1.0.0-nightly.20261027.40445114314` passed all four CLI
native targets and both macOS desktop targets. Both Linux desktop jobs failed
`native-shell-update.mjs` before shell replacement:

```text
ZodError: path [19, "steps", 1, "type"]
Unknown node type: tool
```

The ARM64 job is 121995677562 in build run 40445114314. Its retained artifact
12708835490 contains `desktop/native-shell-update-pending.json` with the exact
stack. Local validation of the same seed reproduced the error. The candidate
was cancelled and remains unpublished; no receipt is relabeled as a pass.

Before opening the fix PR, search covered the whole tracked repository, including
hidden workflow definitions, `apps/desktop/test`, `scripts/tests`, `apps/f1`,
`packages/*/test`, nested fixtures/assets, CLI migration tests and website samples.
Searches covered quoted/unquoted `type: tool/approve/decide`, `askQuestions`,
`human-review`, and old route calls. A second route audit compared string routes
from the installed October 25 source `5d5f2760` with current `FactoryServer.ts`.
Build outputs, installed dependencies and Git objects are not source fixtures.
The classification below preserves original evidence and deliberate legacy
rejection/migration inputs. No check is disabled or newly excluded from CI.

## Maintained checks corrected

| File | Correction and retained intent |
| --- | --- |
| `apps/desktop/test/native-shell-update.mjs` | Replace the removed human-review tool with a real nodes-v1 agent checkpoint followed by a waiting Display. Keep all native worker identity, checkpoint bytes, external helper, complete-shell upgrade, failed-health rollback and suppression assertions. |
| `apps/f1/test-drives/assets/desktop-shell-update.mjs` | Replace manually injected legacy question state with the same real node seed. Keep active-lease deferral, unchanged worker/retained-state receipts, interruption recovery and failed-shell rollback checks. |
| `apps/desktop/test/shell-checkpoint.mjs` | Share strict graph validation and actual controlled execution between both drives. Require a waiting Display document digest and retained native session ID. The existing scripted drive exercises this exact native-fixture seed before packaging. |
| `packages/edge-worker/test/FactoryWebClient.test.ts` | Use `view-answer` for acknowledged mutation/cache behavior. |
| `packages/edge-worker/test/FactoryAccess.test.ts` | Use current view-screenshot/artifact/activity paths for pre-hook authentication and revoked-session checks; keep explicit unknown-path coverage. |
| `packages/edge-worker/test/FactoryPwa.test.ts` | Use current view-screenshot route while retaining the prohibition on caching runtime data. |
| `packages/edge-worker/test/Incremental.test.ts` | Remove obsolete `askQuestions` from an explanation-agent context; retain separate role revisions and output progress assertions. |
| `packages/edge-worker/test/Takeover.test.ts` | Remove an uncalled legacy tool-context constructor and its unused imports; existing inspection tests remain. |

The route comparison found these removed backend routes: `answer`,
`architecture-decision`, `evidence`, `external-recovery`, `external-reverify`,
`guide/refresh`, `question-images/:name`, `recheck`, `review`, `review-files`,
`review-files/:snapshot/:file`, and `screenshots/:index`, under `/api/runs/:id/`.
No maintained release entry point or current package test still calls them.
The maintained native acceptance and unsigned-delivery fixtures already use
Display/view-answer and current node IO; no additional change was needed there.

## Intentional matches retained, file by file

| File | Why the match remains |
| --- | --- |
| `apps/cli/src/migration/migration.test.ts` | Old saved-run/native-session migration inputs. |
| `apps/cli/src/migration/preservation.test.ts` | Preservation inputs must retain their original legacy shape. |
| `packages/edge-worker/src/factory/Workflow.ts` | The explicit unsupported legacy-property rejection list. |
| `packages/edge-worker/test/AgentNode.test.ts` | Asserts new definitions reject old properties and serialization does not restore them. |
| `packages/edge-worker/test/WorkflowCatalog.test.ts` | Asserts a disabled saved legacy tool graph survives verbatim while current catalog edits work. |
| `packages/opencode-runner/test/OpenCodeRunner.test.ts` | Native provider stream events named `tool`; these are not recipe step definitions. |
| `packages/edge-worker/test/fixtures/legacy-workflows-a4990127.json` | Immutable old bundled graphs used for preservation/migration evidence. |
| `packages/edge-worker/test/fixtures/parallel-call-failed-456154f3.json` | Captured saved-state regression input. |
| `packages/edge-worker/test/fixtures/parallel-call-unfinished-456154f3.json` | Captured saved-state regression input. |
| `packages/edge-worker/test/fixtures/stock-role-prompts.json` | Retained complete prompt snapshots, including historical prose; not an executable graph. |
| `apps/f1/test-drives/assets/2026-10-19-api-responsiveness.json` | Historical request observation; changing the recorded route would falsify that drive. |
| `apps/f1/test-drives/assets/2026-10-19-workflow-memory.json` | Historical request observation. |
| `packages/edge-worker/test/fixtures/legacy-execution-context.ts` | Retained pre-cutover helper, with no maintained executable consumer. |
| `packages/edge-worker/test/fixtures/composed-impact.ts` | Retained pre-cutover replay helper, with no maintained executable consumer. |
| `packages/edge-worker/test/drives/taskbot146-reservations.mjs` | Historical reservation drive; its old invoking test is no longer present. Current reservation/node tests are independent. |
| `packages/edge-worker/test/drives/taskbot148-diagnostics.mjs` | Historical diagnostics drive; its old invoking test is no longer present. |
| `website/src/components/Recipes.tsx` | Public pre-cutover recipe illustration, outside runtime/release validation. This audit does not claim that sample is a valid nodes-v1 definition. |
| `website/demo/server.ts` | Companion demonstration branch for the same historical illustration, outside runtime/release validation. |

The following executable assets reproduce historical pre-cutover drives. Their
recorded reports/source identities remain unchanged. None is called by maintained
release workflows, `scripts/tests`, desktop tests or current package tests.
The active node-engine replacements are documented in `NIGHTLY_CI.md` and include
Factory repository/external/mixed, Takeover, Improve, planning/review/QA,
node freshness/effects, authenticated localhost, lifecycle and recovery suites.
These files were already outside the maintained pipeline before this PR:

| Historical asset | Treatment |
| --- | --- |
| `apps/f1/test-drives/assets/architecture-approval-continuation.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/architecture-checkin.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/ci-fix-incomplete-review.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/factory-audit-review-context.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/factory-delivery-boundaries.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/factory-delivery-ci-supervision-native.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/factory-delivery-ci-supervision.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/factory-delivery-edge.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/factory-delivery-fanout.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/frozen-workflow-approval-context.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/git-agent-settings.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/grouped-workflows.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/impact-feedback-recovery.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/linear-publication-101.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/node-registry.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/oldest-run-capacity.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/persistence-responsiveness.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/qa-question-restart.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/question-choices-mock.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/refinement-recommendations-mock.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/review-brief.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/review-story.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/role-finalization-recovery.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/simple-install-onboarding.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/stuck-run-recovery.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/tui-inbox.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/update-lifecycle.mjs` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/workflow-catalog-129.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/workflow-stall-production-replay.ts` | Retain original reproduction/evidence; no current release invocation. |
| `apps/f1/test-drives/assets/workflow-stall-recovery.mjs` | Retain original reproduction/evidence; no current release invocation. |

## Verification

- Local strict validation reproduces the old native seed failure.
- Shared real seed and complete scripted shell drive: both normal and delayed
  receipt-write cases pass, with all five preservation/recovery assertions.
- Focused web-client/incremental/Takeover package tests: 57 passed.
- Desktop unit/protocol checks: 41 passed, one existing Electron-binary skip.
- Final access/PWA checks: 56 passed. Full release safeguards: 181 passed.
  Build/typecheck and PR CI are recorded in the PR as they complete.
- Native Linux AppImage/Electron upgrade and rollback must pass on both actual
  Linux targets in a fresh candidate. Local scripted checks do not claim it.

No production state, run, ticket, native credential store or stable release was
changed. The fresh candidate and genuine normal local updater attempt remain
separate work after the fix passes CI and merges.
