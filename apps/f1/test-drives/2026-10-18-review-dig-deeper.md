# Show & tell with Dig deeper

Date: 2026-10-18. Tested branch `feature/review-dig-deeper` before opening its
PR.

New stock guide steps author `brief-v3`: the show & tell story plus a `tour`
of every changed file, plain flows with code links, `touches` and plain proof
rows. The review page replaces the evidence below the story with Dig deeper
(How it works, The code, Checks, Choices). Regenerating a pending stock guide
upgrades its frozen guide step to the current `brief-v3` prompt.

## Executed checks

- Edge-worker suite (166 files, 2,156 tests): every new and updated test
  passes. New regressions cover the required tour, files placed twice, missing
  or unknown tour files, flow code links to unchanged files, code text in pins
  exempt from the prose rules, the v1/v2/legacy → v3 regeneration upgrade, and
  reformat folding, pin anchoring, line breakdown and tour ownership in the
  reader model. Full parallel runs showed 1–6 timeouts in unrelated restart
  and recovery tests, different in each run; those files pass on their own.
- Simulated-agent F1:
  `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/review-story.ts`.
  Fresh isolated repository/worktrees and CLI-platform EdgeWorker; both
  scenarios passed (`F1_REVIEW_STORY_PASS`). The seeded change adds a feature
  file, its test and a rewrapped README.
  - `story`: the first guide forgot the tour and used an unaccepted screenshot;
    one guide-only correction followed and the accepted guide is `brief-v3`
    with a two-entry tour, served by `GET /api/runs/:id`, still awaiting
    explicit approval.
  - `upgrade`: a run on the old stock chapter-guide prompt reached review, then
    `POST /api/runs/:id/guide/refresh` reran only the guide. Its step became
    `brief-v3` with the current stock prompt and kept `model: fixture-model`;
    the seed ran once, the review gate kept its head and no decision was made.
- Headless agent-browser at 390×844 against the held F1 dashboard
  (`F1_HOLD=1`), after applying the dashboard update prompt: Dig deeper loads
  patches from the real review-file snapshot; the tabs stick below the app
  header; “Show code →” on a flow step opens The code and highlights
  `Hello from F1`; the README diff folds to “2 lines only reformatted”; Checks
  shows “Opened the file → It says Hello from F1” with the recorded values
  behind a disclosure; no horizontal overflow. Screenshots:
  `media/2026-10-18-review-dig-deeper/`.

## Real-agent regeneration (outside F1)

Three existing runs were regenerated offline with Codex (`gpt-6.1-sol`,
medium) from their real evidence in disposable clones at each guided revision,
using the upgraded stock prompt, and checked with the factory's
`validateGuide`: ATT-988 (brief-v2), Taskbot #129 (brief-v1, 152 files) and
Date and Time Format Preferences (chapter guide). Each needed one or two
length corrections (too many interpretations, long hygiene lines), as the
runtime would request; the prompt now states those limits. Rendered with the
real reader components and real diffs, every authored pin landed on a real
diff line (19, 16 and 21), reformat-only hunks folded (7 in Date and Time), and
the tours placed all 57, 152 and 55 files. Two reader fixes came from this:
long diffs now render through their last pin, and long related-file lists show
the first eight behind “Show all”. ATT-988's newest review round has not
reached a guide yet, so it was regenerated at its last guided revision. No
factory state, ticket or PR was changed.

Live provider publication through the installed factory and real phones were
not tested.
