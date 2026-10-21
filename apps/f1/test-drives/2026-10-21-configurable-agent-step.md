# Configurable agent steps: Factory and renamed fork

Date: 2026-10-21. Taskbot project `bobs-factory`, ticket #136, epic #135.

The final integration drive passed for both stock Factory and a fork with every graph step renamed, including nested specialists. Each run used the real EdgeWorker, CLI issue tracker, isolated Git worktree, MockAgentRunner event stream, configurable output validation, actual FactoryTools, human review checkpoint and merge receipt handling. Provider API receipts and agent decisions were scripted; no model or inference API was invoked.

## Tested state

The final drive tested source commit `754228be98fc3bce92baf349bd74f6b7979d2b8c` plus the uncommitted replay harness and evidence files. Source delta SHA-256: `dc46b38e44dda7f82cdfa0caa9dfdc9c1fdf4bfc161138ef00d4b9d4e4717e74`. Built JavaScript SHA-256: `ddc324d3e4094eaaf995ae52566254c6ecda9492b48e5668aa0492a95dc7dcd2`. It ran from `2026-10-21T16:08:03.235Z` to `2026-10-21T16:10:36.540Z` UTC.

Cleaned lockfile SHA-256: `4d5086fbe1f4c882dd7466a569a75da99817eda5a9adeb89aa7526cc86406e72`. The dependency metadata cleanup retained the previously validated JavaScript digest and UI bundle.

The source digest includes `git diff HEAD` and sorted untracked file names/contents as they existed when the drive started. The build digest includes sorted `.js` paths/contents under the core, MCP tools and EdgeWorker distributions. The harness records both before launching the worker. The built JavaScript digest was recomputed after the drive and matched; loading the final web assets also confirmed the captured bundle ID. [Recorded results](assets/2026-10-21-configurable-agent-step/results.json) retain the exact start/end times, native role sequence and run heads. The [full stdout log](assets/2026-10-21-configurable-agent-step/factory-f1.log) preserves the actual drive output.

UI evidence uses final bundle `1a1a48664aff8c7713ab3375`. Server-only validation fixes and dependency metadata cleanup retain the identical captured UI bundle. The complete format catalog and functional UI checks used that same final bundle. Browser-source identity is recorded separately in the browser assertions.

## Commands

```sh
pnpm --filter bobs-factory-mcp-tools build
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-f1 build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/configurable-agent-step.ts
```

The [replayable harness](assets/configurable-agent-step.ts) allocates free loopback ports and a fresh temporary home/repository. It injects MockAgentRunner for every native role and title job. All Git remotes point to temporary local bare repositories; GitHub API responses are intercepted by the controlled forge fixture.

## Assertions and results

- Two issues were created through CLI JSON-RPC, routed through EdgeWorker, and started as separate sessions/worktrees.
- Stock and renamed Factory completed with the identical 18-format role sequence: clarification, planning/review, check-in/review, implementation, impact, inventory, five specialists, coverage aggregation, QA scope/execution/review and human brief.
- Actual local Git changes were committed and pushed twice. Both provider publications and SHA-guarded confirmed merges were simulated; no real PR or remote merge was performed.
- The QA role executed a local file readback assertion in its isolated worktree. Structured agent reasoning, review decisions and guide authorship were mocked.
- Each run waited at a pending human review gate. The harness explicitly approved that exact head before allowing completion.
- Each run exposed 20 nonempty, timestamped CLI activities and 24 durable ticket comments. Pagination with limit 1 returned one activity and `hasMore=true`. CLI completion is recorded in durable comments; Linear transcript response routing was not exercised.
- Native runners, worker listeners and sessions stopped cleanly. Paid provider calls: **0**.

Retained artifacts: [stock activities](assets/2026-10-21-configurable-agent-step/stock-activities.json), [renamed activities](assets/2026-10-21-configurable-agent-step/renamed-activities.json), [stock comments](assets/2026-10-21-configurable-agent-step/stock-comments.json), [renamed comments](assets/2026-10-21-configurable-agent-step/renamed-comments.json).

The unit regression uses the same pure graph renamer and compares the stock and fork visit/tool sequences through publication, QA, explicit approval and merge. The full role-prompt fixture preserves every stock and frozen role prompt byte for byte; its baseline JSON was not regenerated.

## Recipe builder

The product-native T3 browser exercised a real isolated FactoryServer. [Browser assertions](assets/2026-10-21-configurable-agent-step/ui-validation.json) record the final functional recheck. Reads, inline output schema, rules, checks, revision binding, access, allowed tools and shared instructions saved and survived reload. Read-only access rejected native Read/Grep with a clear pinned-tool allowlist, then accepted explicit pinned repository list/read tools. Remote schema references failed live validation and disabled Save. Malformed JSON disabled Save and offered Discard, which restored the saved JSON. Switching from malformed custom-schema text back to a library format cleared the discarded editor error. Unknown format, check and shared-instruction IDs returned specific 400 messages. A script-shaped rule was rejected. Bundled configuration was read-only while native agent preferences remained editable. There was no horizontal page overflow at 1440px or 390px.

All twelve final captures were inspected. The four supplemental mobile captures show Rules and Access in the scrollable bottom sheet. Viewports are CSS dimensions; screenshot pixel dimensions reflect the browser's device scale.

| View | Schema and rules | Evidence, revision and access |
| --- | --- | --- |
| Desktop light | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-desktop-light-schema.png) | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-desktop-light-evidence.png) |
| Desktop dark | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-desktop-dark-schema.png) | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-desktop-dark-evidence.png) |
| 390px light | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-mobile-light-schema.png) | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-mobile-light-evidence.png) |
| 390px dark | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-mobile-dark-schema.png) | [Screenshot](assets/2026-10-21-configurable-agent-step/builder-mobile-dark-evidence.png) |

Supplemental 390px scroll positions: [light Rules](assets/2026-10-21-configurable-agent-step/builder-mobile-light-rules.png), [dark Rules](assets/2026-10-21-configurable-agent-step/builder-mobile-dark-rules.png), [light Access and instructions](assets/2026-10-21-configurable-agent-step/builder-mobile-light-access.png), [dark Access and instructions](assets/2026-10-21-configurable-agent-step/builder-mobile-dark-access.png).

## Targeted checks

`FactoryRolePrompts`, `FactoryStepConfigApi`, `FactoryConfigProjection` and `Guide`: **15 tests passed**. The renamed presentation/API regression plus the unchanged FactoryServer, ReviewState and ReviewContext assertions passed **48 tests**. This includes cold guide/history chunks, configured focus/dashboard roles, full guide hash retrieval, renamed screenshots, and modern generic ID collisions. The existing FactoryWebClient, ReviewFeedback and ReviewOutcome suites passed another **61 tests**. Source and browser TypeScript checks passed during integration. Biome passed for the owned preset, library, builder, API and focused test files. [Complete final gate logs and source identity](assets/2026-10-21-configurable-agent-step/validation/README.md) are retained alongside this report.

The Guide compatibility fixture now loads the actual frozen old stock definition: adding a legacy flag to a modern configured step intentionally cannot override its declared output. Projection assertions account for materialized modern editing fields and new-recipe version markers. These changes preserve the original behavioral assertions.

## Additional maintained script drive

The full script sweep exposed a fixture durability race in the existing desktop-shell F1 drive: it scheduled a waiting-state save without awaiting it, then sometimes captured the preceding running snapshot. The fixture now awaits that existing save before capturing the bytes. No product source or byte-preservation assertion changed. Both normal and delayed-receipt-write drives passed after the correction; [failure output](assets/2026-10-21-configurable-agent-step/validation/desktop-fixture-before-fix.log) and [focused passing output](assets/2026-10-21-configurable-agent-step/validation/desktop-fixture-fixed.log) are retained. The complete script sweep is included in the final validation record.

## Limits

This validates orchestration, safe schema/configuration handling, frozen prompt preservation and actual browser interactions. It does not validate live model quality, real forge authentication/publication, real Linear/Taskbot delivery, or real provider merges. Historical F1 evidence is unchanged.
