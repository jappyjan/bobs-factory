# Generic actions editor and child run list

Fresh browser validation: **PASS** on source `ae847b3573157e0bfa6006ddbadbdb6f4d856481`, tree `34495518ecf931ad4ed5a40157ff7898bb321477`, web build `0a27c450bb0326b3340d8a68`. The fixture started with a clean checkout and used production WorkflowRuntime/FactoryServer, scripted agents and a mocked configured tracker. It created one disposable parent worktree and three distinct child worktrees. No model credits, external tracker writes, real user runs, accepted-receipt edits or production credentials were used.

The unchanged driver is `apps/f1/test-drives/assets/taskbot139-actions-ui.mjs`, SHA-256 `65a35ed967780c164390d8995f59bec8fc0f5e138edb965d6d581a0c2aefbe62`. [Identity](identity.json) records source/backend hashes, served asset hashes, original intents, hook calls, the single mock issue send and both runtime/server reconstructions. [Interactions](ui-interactions.json) retain API observations. [Unchanged-input proof](unchanged-input-proof.json) confirms all 18 captured source files and eight backend modules still matched the clean source after this run. Source fingerprint: `3e297b24e1aa0cc2eb9ed3d98bd80b8658f5cc06d436bfb6b483839ca85fd272`.

This was a fresh run on the new combined source and backend. All served browser asset bytes match the previous build, so the browser build identifier is unchanged. No previous screenshots or interaction results were reused.

## Verified interactions

- Snapshot → scripted read-only proposal → mocked File issues → Launch runs executed through the production action graph. The UI showed three admitted children as waiting, running and completed; dependency wave two retained queued and blocked intents. Completing a child without exact human-approved/provider-confirmed merge proof did not release its dependant.
- The parent showed **Tracking child runs**, with no zero-question label or empty answer form. A child link opened the actual child; its generic **Part of recipe … / See parent run** link returned to the rendered parent list.
- The recipe palette exposed all three actions. Saved `maxItems: 100 → 75` through the normal editor; the accepted run retained 100 and the original children. Malformed JSON raised a parse error, set the field invalid and disabled Save; valid JSON was restored. The invalid-field screenshot shows disabled Save and the malformed value; the parse alert sits below the tall field and is recorded in the interaction receipt.
- Normal **Stop** paused dispatch while existing children stayed waiting/running. Reconstructing the production runtime/server from the same private home and calling normal `resumeAll()` preserved the accepted batch, original IDs and pause. **Bring back → Resume run** unpaused dispatch without re-filing the confirmed issue, recreating worktrees or rerunning the completed child.
- **Stop batch and active runs** cancelled active and pending children while retaining the completed child. A second runtime/server reconstruction retained cancellation and launched no further children. The UI removed the batch-stop control once cancellation was settled.
- The File issues artifact opened in the ordinary structured inspector, exposing the original mocked ticket hyperlink and numeric receipt summary. It was not treated as Markdown or displayed as `[object Object]`.
- No horizontal document overflow was measured in the 390px run-list, parent-link or action-configuration views. All 16 published images were inspected visually; original PNG bytes are retained without cropping or compositing. [Visual QA](visual-qa.json) records the inspection. Normal editor toast messages in some captures do not obscure the configuration field.

## Screenshots

CSS viewports: desktop **1440×1100**, mobile **390×844**. Browser output pixels are **1280×978** on desktop and **780×1688** on mobile. [Manifest](screenshots.json) records each exact size, SHA-256, original artifact path and route. The mobile list is shown in two scroll positions so the dependency blockers and explicit stop action remain readable.

| View | Light | Dark |
| --- | --- | --- |
| Desktop child list | [Light](screenshots/desktop-light-child-list.png) | [Dark](screenshots/desktop-dark-child-list.png) |
| 390px child list | [First wave](screenshots/mobile-light-child-list.png), [second wave](screenshots/mobile-light-child-wave-two.png) | [First wave](screenshots/mobile-dark-child-list.png), [second wave](screenshots/mobile-dark-child-wave-two.png) |
| Generic parent link | [Desktop](screenshots/desktop-light-parent-link.png) | [390px](screenshots/mobile-dark-parent-link.png) |
| Action editor | [Desktop palette/config](screenshots/desktop-light-builder-actions.png), [desktop mapping](screenshots/desktop-light-builder-mapping.png), [390px mapping](screenshots/mobile-light-builder-mapping.png) | [390px mapping](screenshots/mobile-dark-builder-mapping.png) |
| Retained stop state after restart | [Parent stop pauses only](screenshots/mobile-light-parent-stop-restarted.png) | [Desktop batch stop](screenshots/desktop-dark-batch-stop-restarted.png), [390px batch stop](screenshots/mobile-dark-batch-stop-restarted.png) |

Supplement: [Malformed JSON disables Save](screenshots/mobile-light-builder-invalid.png).

## Limits and retained preliminary evidence

These are scripted hooks and a mocked tracker, not native-agent, real provider merge, EdgeWorker intake, machine-capacity or full process-restart claims. Runtime/server objects are reconstructed from actual persisted state; separate F1/runtime evidence covers other boundaries. No uncertain child state was fabricated for the gallery; uncertainty presentation has focused regression coverage. The parent title hook is intentionally absent, so its retained “Generating title…” status is a fixture limitation. The synthetic origin omits optional selection attribution and uses the existing fallback text.

This retest completed through T3 preview without automation errors or a fallback browser. The fixture shut down cleanly at `2026-10-22T02:24:51.570Z` after two runtime/server reconstructions. Evidence was written only to this temporary directory; source and driver remained unchanged.

Prior runs remain separate: `/tmp/taskbot139-ui-preliminary-20261022-0446` is the failed mock response missing its required empty questions array; `/tmp/taskbot139-ui-preliminary-20261022-0447` contains interactions before the UI fixes; `/tmp/taskbot139-ui-final-20261022-0504` contains the previous source run, including its automation/fallback limitations. None is counted as this final source run's passing evidence.
