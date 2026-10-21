# Check builder verification

The actual Recipes builder and production `FactoryServer` were exercised through
T3's collaborative preview against a disposable `WorkflowRuntime`. The Node 24
fixture forbids launching agents, scripts or runs. Its private, fixture-seeded
session does not establish passkey-login coverage. Simulation inputs and evidence
are synthetic; these checks do not authenticate live review or QA receipts.

UI build: `7a010438ed36462fe2fe92f5`. Exact source-file, built-backend and web-asset
hashes are retained in [identity.json](../../../../apps/f1/test-drives/assets/generic-check-ui/identity.json).
This was an integrated development tree on base `95f79ef3`; it is not a claim that
later runtime edits passed this earlier build. The coordinator retains final
source equivalence and full-gate evidence separately. The UI source stayed
unchanged throughout these captures.

Commands, all using Node `v24.21.0`:

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm exec tsgo -p packages/edge-worker/tsconfig.web.json
pnpm --filter bobs-factory-edge-worker exec vitest run test/FactoryCheckEditor.test.ts test/FactoryRecipeGraph.test.ts
node packages/edge-worker/scripts/build-factory-web.mjs
node apps/f1/test-drives/assets/generic-check-ui.mjs
```

The focused run passed **2 files / 19 tests**. The web typecheck and build passed.
These targeted checks supplement the coordinator's required final gates.

The [browser receipt](../../../../apps/f1/test-drives/assets/generic-check-ui/verification.json)
retains exact saved definitions, expected and actual outputs/routes, 257 recorded
native interaction events, and limitations. The driver used native preview
click/type/select actions. Event values are truncated to 150 characters; complete
saved configurations are retained separately in that receipt.

Verified behavior:

- The palette creates and saves a modern Check without an agent or tool.
- A structured result rename and its passed-rule reference save exactly. A new
  filter aggregation and its item predicate save exactly, then can be removed.
- Malformed JSON remains visible, reports an inline error and disables Save on
  desktop and at 390px. Returning to valid JSON restores structured editing.
- A missing collection reports its exact missing path and offers no route.
  Undeclared synthetic evidence cannot activate a review check.
- Passing input returns `{passed:true,allApproved:true,openFindings:0}` and
  Continue follows the recipe's default `approved` route. A rating-2 finding
  returns `{passed:false,allApproved:false,openFindings:1}` and follows the
  declared `passed=false` branch to `changes`. Rating-1 entries do not count.
- An invalid simulation draft clears the previous output and disables evaluation.
- The editor and simulation have no horizontal document/container overflow at
  390px. The Check node, editable fields, nested rules, route summary and error
  states were visually inspected in light and dark mode.

Screenshots use measured CSS viewports **1440×1000** and **390×844**. The preview
tool saves desktop images scaled to 1280 pixels wide and mobile images at device
pixel ratio 2. [screenshots.json](../../../../apps/f1/test-drives/assets/generic-check-ui/screenshots.json)
records both CSS and image dimensions plus each original PNG's SHA-256.

| State | Light | Dark |
| --- | --- | --- |
| Desktop editable Check and canvas node | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/desktop-light-editor.png) | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/desktop-dark-editor.png) |
| 390px editable Check and canvas node | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-light-editor.png) | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-dark-editor.png) |
| 390px structured collection rule | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-light-rule.png) | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-dark-rule.png) |
| 390px JSON save error | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-light-json-error.png) | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-dark-json-error.png) |
| Simulation output and declared continuation | [Desktop failure](../../../../apps/f1/test-drives/assets/generic-check-ui/desktop-light-simulation-fail.png) | [Desktop pass](../../../../apps/f1/test-drives/assets/generic-check-ui/desktop-dark-simulation-pass.png) |
| 390px simulation output and continuation | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-light-simulation-result.png) | [Image](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-dark-simulation-result.png) |

[Desktop JSON error and result summary](../../../../apps/f1/test-drives/assets/generic-check-ui/desktop-dark-json-error.png)
and the [390px route summary](../../../../apps/f1/test-drives/assets/generic-check-ui/mobile-light-routes-summary.png)
show that ordinary recipe branches consume named Check results.
