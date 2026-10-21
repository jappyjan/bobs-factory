# Final browser evidence for #136 round 2

Validated source: `7106f734ca6fc4066448e2766495f5bacb4fa0d9` ([PR #173](https://github.com/jappyjan/bobs-factory/pull/173)).
Node `v24.21.0`; Bun `1.4.2`.
UI build `8d8dd7cd2aaf5584cdb1b564`, script `app.82c170ddbb6d24d1a701f7fb.js`.

- Production input digest: `f92022cd6f7880be4eb531d027bb3df7ca947ac8ac237a6165f3ab9ea882adfb`.
- Artifact digest: `f19164f64fa9050e49b04f4a5bb56b9cceea8c40a8115e57c5a584f110796ad1`.
- All 11 UI files match the clean-build manifest. The nine public assets, including root HTML, match the bytes served by both fixture servers. The two build metadata files are deliberately not public routes.
- 32 PNGs: eight historical reviews, fourteen builder panels, four modern working states, four modern reviews, and two screenshot previews. Desktop CSS viewport 1440×1000, stored PNG 1280×889. Mobile CSS viewport 390×844, stored PNG 780×1688. Light/dark state and no horizontal document overflow were checked before captures.

[Manifest and image hashes](manifest.json.txt) · [Browser actions and API results](browser-proof.json.txt) · [Progress after loading a fresh document](progress-reload-proof.json.txt) · [Immutable state proof](immutable-state-proof.json.txt) · [API field hashes](api-runs.json.txt) · [Clean-build manifest](final-build-manifest.json.txt).

## Actual historical production loading

Two files containing the genuine a4990127 Factory accepted definitions were loaded by the production `WorkflowRuntime` and served by `FactoryServer`. Both retained raw leaf `guide` and `capture` outputs, exact qualified executed history, and the sparse persisted guide used by the reviewer. One is pending human review; the other is completed.

In the actual browser, both runs rendered Overview, the retained chapter, Changed files, and Decide. Browser error and unhandled rejection collection remained empty. Missing historical decision, requirements, verification, and instructions render neutral absence. No replacement parsed receipt is stored. A chapter reading marker was selected, then a fresh document was loaded; the checkbox and chapter progress remained selected with the exact accepted revision.

Both default media endpoints returned HTTP 200, exactly 68 bytes, SHA-256 `5d33f59da4616d85727498b31cc7c8276596c6416bc660dee49a6bc907984eb9`. The artifact gallery and expanded image preview loaded the same original 1×1 PNG; its white appearance is the fixture image, and the browser reports `complete:true`, natural size 1×1.

Original saved JSON backup bytes still match their starting SHA-256 values. The API's workflow, accepted definition collection, and outputs hash identically to the original JSON. Output keys remain `guide`, `capture`, and `draft-pr`; no qualified aliases were written. Normal snapshot storage migration preserves the original `.legacy` file. The derived role revision view adds the proven guide alias while leaving the stored qualified role revision unchanged.

The fixture deliberately has no exact historical Git base/head receipts. Changed files therefore returns the existing HTTP 409 and shows “Exact historical base/head receipts are unavailable.” This is the expected fail-closed result; no diff authority or approval safeguard was bypassed.

The narrow historical adapter remains gated by a wholly old accepted graph, unique producer, exact qualified executed history, and unambiguous last writer. The focused suite retains modern/mixed graph, missing graph/history, copied/unexecuted/sibling/root collision, mismatched receipt, and unrelated role revision negatives.

## Modern behavior and builder

The modern working row displayed the configured Watch Build identity and current Build pending state despite an older successful CI receipt. The renamed review retained its Refresh guide action. Clicking it issued the actual POST `/api/runs/ticket136-renamed-review/guide/refresh` and returned 202; the old guide remained readable while refresh was pending. Agents in these controlled fixtures are deferred, so no provider or Git publication action occurred.

The editable Factory fork exposed Reads, Output format, custom JSON Schema, Rules, Checks, Revision binding, Access, Allowed tools, and Shared instructions. Selecting Custom JSON Schema and entering a valid schema produced “Schema is valid.” Schema and evidence panel captures cover desktop/mobile and light/dark. This was an unsaved draft in a disposable fixture.

## Screenshots

| Historical review | Desktop light | Desktop dark | 390px light | 390px dark |
| --- | --- | --- | --- | --- |
| Pending, restored Decide page | [PNG](screenshots/historical-pending-desktop-light.png) | [PNG](screenshots/historical-pending-desktop-dark.png) | [PNG](screenshots/historical-pending-mobile-light.png) | [PNG](screenshots/historical-pending-mobile-dark.png) |
| Completed, Overview with retained progress | [PNG](screenshots/historical-completed-desktop-light.png) | [PNG](screenshots/historical-completed-desktop-dark.png) | [PNG](screenshots/historical-completed-mobile-light.png) | [PNG](screenshots/historical-completed-mobile-dark.png) |

| Current UI | Desktop light | Desktop dark | 390px light | 390px dark |
| --- | --- | --- | --- | --- |
| Builder schema | [PNG](screenshots/builder-desktop-light-schema.png) | [PNG](screenshots/builder-desktop-dark-schema.png) | [PNG](screenshots/builder-mobile-light-schema.png) | [PNG](screenshots/builder-mobile-dark-schema.png) |
| Builder evidence/access | [PNG](screenshots/builder-desktop-light-evidence.png) | [PNG](screenshots/builder-desktop-dark-evidence.png) | [PNG](screenshots/builder-mobile-light-evidence.png) | [PNG](screenshots/builder-mobile-dark-evidence.png) |
| Modern working | [PNG](screenshots/modern-working-desktop-light.png) | [PNG](screenshots/modern-working-desktop-dark.png) | [PNG](screenshots/modern-working-mobile-light.png) | [PNG](screenshots/modern-working-mobile-dark.png) |
| Modern review | [PNG](screenshots/modern-review-desktop-light.png) | [PNG](screenshots/modern-review-desktop-dark.png) | [PNG](screenshots/modern-review-mobile-light.png) | [PNG](screenshots/modern-review-mobile-dark.png) |

[Historical screenshot gallery](screenshots/historical-screenshot-preview-desktop-light.png) · [Expanded original screenshot](screenshots/historical-screenshot-expanded-desktop-light.png).

Captured images were visually inspected across historical and modern review, working, builder, and image preview states. Theme, viewport, overflow, expected page content, and image hashes are recorded per image. Pending screenshots preserve the last visited Decide page; completed screenshots show the retained Overview progress.

## Focused regression evidence

[Seven focused files: 73/73 passing](logs/legacy-navigation-green.log). This includes normal production historical loading, all four reader pages, actual progress storage handler inputs, strict modern ownership negatives, media routes, and schema-valid modern empty-check rendering. [Web typecheck](logs/legacy-navigation-types.log) also passed. Full package gates, F1, and binary evidence are owned and reported separately by the parent.

Reproduction scripts are [historical fixture](legacy-ui-fixture.mjs.txt) and [modern/builder fixture](modern-ui-fixture.mjs.txt). Their checkout paths refer to the retained recovery worktree. Fixture state is disposable; keys in the scripts are synthetic local test credentials. This packet was assembled entirely outside the checkout without changing source, dependencies, or dist.


## Mobile settings follow-up

Six additional final-source frames show Reads bindings, the current Rules body with declarative-rule help, and the Shared instructions selection list in both themes. These are ordinary panel scroll positions; no source, style, or recipe configuration was changed. The original 26 PNGs remain byte-identical; their original manifest is retained in [manifest-original26.json.txt](manifest-original26.json.txt). [Panel values and selection proof](mobile-settings-followup.json.txt).

| Panel | 390px light | 390px dark |
| --- | --- | --- |
| Reads | [PNG](screenshots/builder-mobile-light-reads.png) | [PNG](screenshots/builder-mobile-dark-reads.png) |
| Rules body | [PNG](screenshots/builder-mobile-light-rules.png) | [PNG](screenshots/builder-mobile-dark-rules.png) |
| Shared instructions | [PNG](screenshots/builder-mobile-light-instructions.png) | [PNG](screenshots/builder-mobile-dark-instructions.png) |
