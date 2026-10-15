# Simple-only launcher settings

**Date:** 2026-10-15
**Result:** Passed with simulated agents and headless Chromium.
**Source:** Base `e9ec4f914fd8ec7745c475941c0afd164a35cc15`, plus this worktree's launcher/capability changes. No commit or publication was performed by the implementation role.
**Fixture:** `media/2026-10-15-simple-launch-settings/f1-drive.ts`

The launcher now offers agent settings only for the launchable workflow whose ID is `simple`. Other workflows keep their step settings from Recipes. Identity and tool profiles remain independent.

## Execution

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker test:run test/FactoryLauncher.test.ts test/FactoryWebClient.test.ts test/FactoryAgentSettings.test.ts test/FactoryExecution.test.ts test/WorkflowRuntime.test.ts test/prompt-assembly.routing-context.test.ts
F1_AGENT_MODE=mock bun run apps/f1/test-drives/media/2026-10-15-simple-launch-settings/f1-drive.ts --serve
agent-browser --headed false --session simple-settings-19a6 open http://127.0.0.1:55566
```

The six targeted suites passed (172 tests at the shared-suite run). After separating supported Simple provider cases and strengthening hidden-form assertions, the launcher suite passed again with 10 tests, replacing its earlier nine. Typecheck, build, changed-file Biome checks and `git diff --check` passed. Initial shared checks could not resolve unbuilt workspace packages; building dependencies resolved those failures without dependency changes.

The fixture created a fresh home and two local Git repositories under `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/simple-settings-f1-VO9zuO`. Its Factory listener used port 55566. HTTP requests used the actual Origin, action, build and configuration guards. Every provider and background title runner was intercepted by `MockAgentRunner`; no inference provider was called.

## Assertions and observations

| Behavior | Evidence / result |
| --- | --- |
| Non-Simple controls | Factory, Takeover and a custom workflow named Simple hid agent controls and separators. Focused tests also covered unknown, disabled, unavailable and non-manual Simple selections. |
| Dialog controls | Simple retained agent/model/reasoning/service-tier controls, and OpenCode exposed its variant. Other workflows showed execution profiles and the Recipes explanation. |
| Stale overrides | Selected Codex model, high effort and fast tier in Simple, then changed recipes. The custom workflow's actual browser launch JSON omitted runner, model, reasoningEffort, modelVariant and serviceTier. Controlled-hook tests supplied all five stale fields directly and verified the same omission. |
| Configuration previews | Factory and custom browser preview JSON omitted runner and model. Both returned the existing Legacy execution preview successfully. Identity and tool profile controls remained usable. |
| Per-step execution | The custom workflow ran Codex/fixture-codex/low/standard, then Claude/fixture-claude/high. Recorded simulated runner configurations matched, including the browser-admitted run. |
| Simple execution | Separate HTTP and browser cases preserved Codex model/high/fast and OpenCode model/custom-review. Provider changes cleared the previous provider's model, effort and tier. |
| Direct API compatibility | An explicit non-Simple API launch still accepted model and reasoning overrides. Step-specific settings continued taking precedence as before. |
| Admission failures | Missing required prompt and disabled selection were rejected through guarded HTTP. Takeover retained its required source field and disabled Start until supplied. |
| Recipe resets | Returning to Simple cleared agent edits. Typed text survived recipe and project switches; the project heading and scope changed together. |
| Attachments | A staged notes.txt survived Simple → custom switching and appeared in the custom launch request. Its claimed manifest belonged to the selected app repository. |
| Live dialog updates | Disabling the selected Simple workflow through guarded HTTP while Run settings was open immediately removed agent controls, keeping the dialog open. Re-enabling restored availability. Changing the saved default to Factory cleared the draft and closed the dialog as the existing form context requires. |
| Navigation/reload | Navigation to Recipes and back cleared typed text and model edits, restored the saved default workflow/project and closed Run settings. Reload also cleared unsent model/effort edits and restored the saved default. |
| Responsive rendering | Inspected all six captures at 1440×1000 and 390×844. Dialog controls and profile previews fit. Simple's narrow composer retains its existing compact agent pill layout. |

A modal prevents ordinary pointer interaction with the recipe menu behind it. Live removal while open was therefore exercised through a real availability update; recipe-change/open-dialog combinations also have focused render coverage. No modal behavior was changed to make an inaccessible gesture possible.

## Evidence

Evidence directory (outside the repository):
`/Users/jappy/.bobs-factory/factory/evidence/manual-05131462-c641-4a6d-b5ba-859819a6f741/`

- `simple-composer-desktop.png`, `simple-settings-desktop.png`
- `simple-composer-mobile.png`, `simple-settings-mobile.png`
- `factory-settings-desktop.png`, `factory-settings-mobile.png` (the mobile image uses the non-Simple custom recipe)
- `browser-requests.json`: captured actual fetch bodies, with no injected response substitution.
- `received-runner-configs.json`: configurations observed by simulated runners.
- `disabled-open-dialog.json`: dialog contents after live availability removal.
- `f1-drive.log`: HTTP drive and simulated execution log.

Saved request evidence was parsed independently: all five forbidden launch keys and both forbidden preview keys were absent; Simple's supported selections and the carried attachment were present. Recorded runner settings were also asserted against the browser selections.

Tested launcher SHA-256: `0218282da65a71d9e33a1c30822bf8cb983bd06a01f9893fb25c10534e5c0b69`.
Tested capability producer SHA-256: `9c1770742c309a2d90b7dd08161835eddc11abcdd3a2b63f4b572606ac4f9824`.

## Cleanup and limitations

Closed only the named headless browser session and stopped the isolated fixture with SIGTERM; worker shutdown completed. Temporary homes and run evidence remain available for inspection. No production configuration, ticket, PR or branch was changed by the fixture.

This proves browser admission and configuration propagation using simulated agents. Real model availability, native effort behavior and explicit credential-backed profile execution were not tested. Profile controls and Legacy previews were exercised. The standalone Simple fixture logs missing synthetic ticket comments and missing source-tree bundled-skills warnings; simulated executions still complete. Real ticket integration is outside this launcher correction.
