# Bob checks in before building

Date: 2026-10-20. Tested the check-in branch before opening its PR.

New stock architecture steps write a check-in (`briefVersion: 2`,
`architectureBrief: checkin-v1`): what Bob thinks you want, how he’d do it with
before/after scenes of what people experience, who will notice, the calls he
wants checked, size and an optional split, and what he won’t do or can’t fully
prove. The review brief (findings, criteria, deliverables and files, decisions,
map, risks, evidence, full plan) stays as Bob’s notes. The page is one
conversation: each point takes 👍 or a note, notes go back as one change request,
otherwise “Go ahead, build it” accepts the exact version. Asking for changes on a
pending stock `review-v1` proposal switches the run to the check-in prompt and
reviewer.

## Live drive (real Codex)

`env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=live bun apps/f1/test-drives/assets/architecture-checkin.ts`

Real CLI-platform EdgeWorker, real Git worktrees of a small notes service whose
ticket asks for private notes with per-user sharing. The check-in author and its
reviewer ran as real Codex sessions (`gpt-6.1-sol`, medium); only the implementer
was a fixture. Both scenarios passed (`F1_CHECKIN_PASS`), with 12 real Codex
sessions in total.

- `checkin` (new stock steps): Bob’s reviewer sent v1 back, so it never reached
  the human (no `shownAt`). v2 was shown (`shownAt` recorded, `GET
  /api/runs/:id?view=architecture` returned its talk). A note sent through
  `architecture-decision` (`revise`) produced v3, whose changes Codex attributed to
  the human (`from: "you"`, individual usernames only); v2 became `rejected`.
  Go-ahead accepted v3 and the implementer ran exactly once; the run completed.
- `upgrade` (frozen previous stock prompts, `review-v1`): v1 was a review brief.
  Asking for changes switched the run’s frozen steps to the check-in prompt and
  reviewer, keeping `model: gpt-6.1-sol`, and logged “written as a check-in”. v2
  went back to the reviewer; v3 is a check-in still waiting for explicit approval.

Each check-in was 261–288 words and flagged exactly one call for the human
(recipient validation), keeping settled choices in Bob’s notes.

## Dashboard

Served the held F1 home with the final build and checked it at 1280×900 and
390×844, light and dark: no horizontal overflow, Today shows “Bob wants to check
in” with what Bob thinks you want, flagging a call opens a note and turns the
action into “Send 1 note to Bob”, and an accepted check-in is read-only.
Screenshots: `media/2026-10-20-architecture-checkin/`.

Found and fixed during the drive:

- The upgrade run’s note was handled in a draft the reviewer sent back, so v3’s
  own changes did not mention it. “Since you last looked” now collects changes from
  every version after the last one the human saw.
- The run-list summary lacked the check-in, crashing the Today card; the summary
  now carries what Bob thinks you want.
- Codex wrote approval status into `changes`; the prompt now limits changes to the
  plan itself. This live drive ran before that prompt edit.

## Real run (outside F1)

ATT-1149 (“Protect resource reads, browser sessions and new-device
enrollment”) was regenerated offline with Codex from its real worktree and run
context: the check-in validated on the first attempt (315 words, three scenes,
one call to check: unmeasured enrollment limits). Rendered in the dashboard from
an in-memory copy, the page is about 4,200 px instead of 16,200 px; its pending
v14 is retold from its summary, Bob’s decisions and size. 12 of its 14 versions
were reviewer drafts and are now counted, not listed. No factory state, ticket or
PR was changed.

Live ticket publication and physical phones were not tested. Listen uses the
browser’s speech synthesis and was not judged for voice quality.
