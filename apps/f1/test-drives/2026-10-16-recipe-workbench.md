# Visual Recipes workbench

Date: 2026-10-16. Tested commit `ffdf3458931a25501c93682db76bcffe41bca4dc` (rebased on `main` at `4c6ad3c4`).
Driver: [recipe-workbench.ts](assets/recipe-workbench.ts).
Receipt: [receipt.json](assets/recipe-workbench/receipt.json),
log: [drive.log.raw](assets/recipe-workbench/drive.log.raw).

## Changed behavior

The Recipes page replaces the card list and raw workflow JSON with a gallery
and a full-screen canvas builder. Recipes are now authored visually: steps are
inserted from a palette, conditional routes are drawn between steps and
completed in the inspector, and edits are saved as a draft through the existing
`PUT /api/workflows` API. Bundled graphs stay read-only while their agent
settings save as preferences. Changes made elsewhere block a stale save.

## Applicable F1 validation

The editor now writes the step graphs that the EdgeWorker executes, so a graph
built in the UI could save successfully yet route differently than drawn. The
drive builds a recipe only through the browser and then runs it on the real
EdgeWorker to assert the runtime follows the drawn branch.

The fixture used a disposable home, Git repository and bare remote, the actual
EdgeWorker, CLI issue tracker and protected Factory HTTP listener on port 3641,
and headless Chromium through `agent-browser` at 1280×800. Agents were mocked;
the authored recipe used local script steps. No provider, tracker or forge was
contacted.

```sh
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/recipe-workbench.ts
```

## Results

All seven checks passed:

1. The gallery shows one card per recipe in the live catalog.
   ([gallery](assets/recipe-workbench/gallery.png))
2. A new recipe was built through the UI: three script steps inserted from the
   palette and named in the inspector, the starter step deleted, and a route
   drawn by pointer gesture from “Check approval” to “Branch path”. Saving with
   the new route's condition still empty was refused with an explanation.
   ([steps](assets/recipe-workbench/authored-steps.png))
3. After typing the condition `approved` is `false`, the saved definition
   contained exactly the three steps and the branch
   `{ when: { path: "approved", equals: false }, next: "script-3" }`.
   ([condition](assets/recipe-workbench/authored-branch.png))
4. A manual run of that recipe on the EdgeWorker completed with history
   `script-1 → script-3`, skipping the default step, and `script-3` produced
   `{ "path": "branch" }`.
5. The simulator offered “✓ All good → Default path” and “Changes requested →
   Branch path”, and walking the branch produced the trail
   “Check approval → Branch path”.
   ([simulation](assets/recipe-workbench/simulation.png))
6. The bundled Software factory showed “Fork to add steps”; changing the plan
   step's agent to Codex saved `preferences["factory-pipeline"].plan.runner`
   and the runtime's bundled plan step resolved to Codex.
   ([bundled](assets/recipe-workbench/bundled-preference.png))
7. While a step name was being edited in the browser, the same recipe was
   renamed through the API. The builder reported the conflict and disabled
   Save; Discard reloaded the stored “Edited elsewhere” version.
   ([conflict](assets/recipe-workbench/conflict.png))

## Defect found and fixed during the drive

Repeated runs showed that after deleting a step, routes sometimes could not be
drawn: xyflow hid nodes and dropped their handle bounds because the canvas
rebuilds nodes without xyflow's measurements. Commit `0cd139e9` declares each
node's size and handle geometry. Eight consecutive drives then passed, and the
final commit passed three more consecutive runs; the last is recorded here.

## Limitations

Mock agents and scripted steps only; no live model or tool behavior. Headless
Chromium does not paint hidden tabs continuously, so the driver captures a
screenshot and waits for the route handle to be hit-testable before the pointer
gesture. Phone layout, dark mode, JSON apply, Simple's native agent settings,
forking, the disable impact dialog and new-recipe creation were checked
manually in the same browser against the same fixture design, not by this
driver.
