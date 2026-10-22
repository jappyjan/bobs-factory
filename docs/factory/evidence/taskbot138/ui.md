# For each builder and run activity

Browser validation: **PASS**. Actual T3 collaborative browser, built Factory web UI,
production FactoryServer/WorkflowRuntime, scripted local provider hooks. No native
model or paid-provider claim. [Exact identity](ui-identity.json), [interactions](ui-interactions.json),
[original PNG manifest](screenshots.json). The fixture is
[`taskbot138-foreach-ui.mjs`](../../../../apps/f1/test-drives/assets/taskbot138-foreach-ui.mjs).

Production source `9b79a19f7b672a8a759400cc9f715aec3f140635`, web build
`37aae3292ed089cb18e738f1`. At fixture startup only the fixture readiness wait was
modified; that exact driver was committed as `31c3c6330159844c098a52716882d415668edf05`.
It waits until all five expected hooks have entered, as well as checking per-item
statuses. No compiled source or built web asset changed. The identity records the
actual dirty fixture state, source/backend hashes, served asset hashes and all
hook calls, rather than inventing a clean source identity for that startup.

The accepted run really has five item frames at concurrency two: security
completed, runtime failed with an explicit limitation, accessibility and performance
running, maintainability pending. Those states arise from normal runtime dispatch;
no run state, accepted output or receipt was patched. Two scripted hooks intentionally
wait until cleanup. The final Check is unreached in this progress fixture. The
fixture was stopped normally at `2026-10-21T23:35:24.364Z`; its stopped progress
retains completed/failed receipts and records unfinished items as cancelled.

## Observed interactions

- Selected the For each container and inspected its source, named reads, concurrency,
  maximum items, failure policy, item ID pointer and real editable body JSON.
- Changed concurrency from two to three and clicked **Save**. A subsequent config
  read confirmed three; the active run retained its accepted two. The captured builder
  shows three while the run shots show its retained two.
- Entered malformed named-read JSON. The inline parse error appeared and **Save**
  was disabled. Restored valid JSON afterward; the invalid value was never saved.
- Started actual UI simulation with three selected item values, chose Pass, Fail and
  Visit limit. It retained one keyed success plus two explicit failures/limitations.
  Simulation uses production snapshot/aggregation helpers and selectable synthetic
  body outcomes. It does not execute called/nested recipes, model turns or effects.
- Used Fit view on the 390px canvas and scrolled the settings and run item lists.
  Both themes were inspected visually. No horizontal document overflow at 390px.

## Screenshots

CSS viewports were desktop 1440×1000 and mobile 390×844. Browser screenshot output
is 1280×889 on desktop and 780×1688 on mobile; original bytes are retained without
cropping or compositing. The manifest records SHA-256, size, pixel dimensions,
original artifact path, route and file timestamp for every capture.

| Screen | Light | Dark |
| --- | --- | --- |
| Desktop builder, real body/container | [Source](screenshots/desktop-light-builder-source.png), [Body](screenshots/desktop-light-builder-body.png) | [Body](screenshots/desktop-dark-builder-body.png) |
| 390px builder source and concurrency | [Light](screenshots/mobile-light-builder-source.png) | [Dark](screenshots/mobile-dark-builder-source.png) |
| 390px builder limits/failure settings | [Light](screenshots/mobile-light-builder-body.png) | [Dark](screenshots/mobile-dark-builder-body.png) |
| 390px body JSON | [Light](screenshots/mobile-light-builder-body-json.png) | [Dark](screenshots/mobile-dark-builder-body-json.png) |
| 390px container canvas, Fit view | [Light](screenshots/mobile-light-builder-canvas.png) | [Dark](screenshots/mobile-dark-builder-canvas.png) |
| Desktop run progress | [Light](screenshots/desktop-light-run-progress-final.png) | [Dark](screenshots/desktop-dark-run-progress-final.png) |
| 390px run progress | [Light](screenshots/mobile-light-run-progress-final.png) | [Dark](screenshots/mobile-dark-run-progress-final.png) |

Supplemental: [scrolled pending item](screenshots/mobile-dark-run-pending.png),
[malformed read disables Save](screenshots/mobile-light-malformed-read.png),
[synthetic per-item simulation results](screenshots/mobile-light-simulation-results.png).
The supplemental pending-item image is scrolled down; use the final run-progress
matrix for the complete panel heading and counts.

A preliminary fixture start checked the hook count before already-running frames
had entered their hooks; it stopped with a readiness assertion. The corrected
readiness wait affects only evidence timing. Its failed log is retained separately
and is not counted as a passing browser run.

Generated JSON receipts have readable repository-formatted copies; [original byte receipts](raw-json.json) retain their exact original JSON in gzip form. Recorded original hashes refer to the decompressed raw copies. PNG and driver bytes are unchanged.
