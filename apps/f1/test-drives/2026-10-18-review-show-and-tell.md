# Show & tell review guides

Date: 2026-10-18. Tested branch `feature/show-and-tell-review-guide` before
opening its PR.

New stock guide steps author `brief-v2`: the review brief plus a colleague-style
story that the review page presents first. Regenerating a pending stock guide
upgrades its frozen guide step to the current `brief-v2` prompt.

## Executed checks

- Edge-worker suite: 165 files, 2,148 tests passed. New regressions cover the
  required story, story screenshots outside the accepted capture inventory,
  local paths in story prose, stock guide upgrade selection and regeneration.
- Simulated-agent F1:
  `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/review-story.ts`.
  Fresh isolated repository/worktrees and CLI-platform EdgeWorker; both
  scenarios passed (`F1_REVIEW_STORY_PASS`), three scripted PR descriptions.
  - `story`: the first guide put an unaccepted screenshot in a story slide and
    returned for one guide-only correction; the accepted guide is `brief-v2`
    with three slides, served by `GET /api/runs/:id`, and still awaits explicit
    approval.
  - `upgrade`: a run on the old stock chapter-guide prompt reached review, then
    `POST /api/runs/:id/guide/refresh` reran only the guide. Its step became
    `brief-v2` with the current stock prompt and kept `model: fixture-model`;
    the seed ran once, the review gate kept its head and no decision was made.
- Headless agent-browser at 390×844 against the held F1 dashboard
  (`F1_HOLD=1`): the regenerated run's review page shows the `SHOW & TELL`
  label and a six-slide deck with the evidence collapsed and no horizontal
  overflow. Choosing “Change it” on the decision slide opened the evidence,
  scrolled to the matching “Your call” line and opened its comment editor.
  Screenshots: `media/2026-10-18-review-show-and-tell/`.
- The existing `review-brief.ts` driver currently fails its first `f1 ping`
  with HTTP 404 because it does not inject `createCLIIssueTracker`; the new
  driver injects it like `apps/f1/server.ts`.

## Real-agent regeneration (outside F1)

Three existing runs were regenerated offline with Codex (`gpt-6.1-sol`,
medium) from their real evidence in disposable clones at each PR head, using
the upgraded stock prompt, and checked with the factory's `validateGuide`:
ATT-988 (brief-v1), Taskbot #129 (brief-v1) and Date and Time Format
Preferences (chapter guide). Each needed one or two length-limit corrections,
as the runtime would request, then validated. The stories were judged useful;
an ATT-988 chart of two identical totals, vague limits and leftover jargon led
to prompt rules for distinct-case charts, concrete limits, plain decision text
and focus crops. A rerun confirmed the chart and limits improved. No factory
state, ticket or PR was changed.

Live provider publication through the installed factory and real phones were
not tested.
