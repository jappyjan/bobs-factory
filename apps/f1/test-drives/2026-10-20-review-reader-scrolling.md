# Review reader: disclosure, scrolling and fixed controls

Date: 2026-10-20. Tested `t3/review-guide-ui-polish`, working changes on
`dd0b591a`; dashboard build `52c4e6952b00c91c0fff808c`.

## Changed behavior

Dig deeper starts collapsed and opens for explicit evidence links. Its tabs and
flow participants scroll with the document. Slide navigation uses buttons and
arrow keys, with no swipe or tap-anywhere navigation. Navigation and decisions
share a fixed footer, with measured space reserved below the content and safe
area padding. Phones omit the revision hash and progress counts to keep the
controls in two rows.

## Executed validation

- `pnpm --filter 'bobs-factory-edge-worker...' build`: passed, including the
  dashboard bundle and workspace prerequisites.
- `pnpm --filter bobs-factory-edge-worker typecheck`: passed after the final
  reader changes; rebuilt the dashboard with its normal build script.
- Edge-worker Vitest: `ReviewDive`, `ReviewModel`, `FactoryReviewState`, and
  `FactoryWebClient`: 4 files, 74 tests passed.
- Biome checks passed for the changed TSX and CSS with no errors (CSS still
  reports non-blocking specificity/important-style warnings); `git diff --check`
  passed.
- Mocked F1 with real Git/worktrees, EdgeWorker, API and dashboard:
  `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock F1_HOLD=1 bun apps/f1/test-drives/assets/review-story.ts`.
  Both stock story and regenerated legacy guide scenarios passed
  `F1_REVIEW_STORY_PASS`. Both still awaited explicit human approval.
- T3 collaborative browser against the held F1 dashboard:
  - Dig deeper was closed on a fresh page. Its summary toggled it, and the
    story's Dig deeper button reopened the closed disclosure.
  - Synthetic touchstart/touchend and a tap on slide content retained slide 1.
    Back/Next changed slides; Next after scrolling returned the story below
    the actual header (157px vs a 145px header at 320px width).
  - At 320×568, 390×844 and 1280×800, no horizontal document overflow and the
    footer bottom equaled the viewport bottom. Phone controls occupied 117px
    in two rows; desktop controls occupied 65px in one row.
  - Four alternating scroll increments moved flow participant labels by
    exactly the document scroll delta, with zero drift; the footer stayed fixed.
  - Show code selected The code and highlighted `Hello from F1` in the real
    review-file patch. Checks remained reachable and showed the requirement.
  - Scrolling to the end left all final content above the footer on desktop
    and mobile. No approval, feedback submission or merge was performed.

The fixture used deterministic mocked agents and scripted GitHub responses.
Physical touch devices and live provider publication were not tested. The held
worker was stopped after browser checks; temporary fixture state stayed in `/tmp`.

Screenshots from the same mocked fixture after final validation:
[desktop, collapsed](media/2026-10-20-review-reader-scrolling/desktop-collapsed.png)
and [mobile, scrolled](media/2026-10-20-review-reader-scrolling/mobile-scrolled.png).
