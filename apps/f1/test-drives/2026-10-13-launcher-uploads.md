# Manual launcher and private workflow uploads

Date: 2026-10-13. Taskbot [#85](https://taskbot.apps.janjaap.de/p/bobs-factory/t/85).

The launcher now asks "What should we build in <project>?" with the project
name as its selector, shows attachments as chips inside a chat-style composer,
and accepts files only for declared attachment fields. Machine selection remains separate work in BOBS-84.

## Applicability and evidence

F1 applies to manual admission, attachment persistence, workflow context and
runner read access. This drive uses isolated temporary homes, two fresh local
Git repositories grouped by routing labels, the real EdgeWorker/FactoryServer
HTTP path, and deterministic F1 `MockAgentRunner` instances for every role and
title job. It does not invoke an agent CLI or inference API.

Expected outcomes were exact uploaded bytes in role context, complete grouped
scope, rejection of undeclared/required/oversized inputs, single ownership under
concurrent admission, retained restart/retry state and usable Simple instructions.
All executed assertions passed:

| Path | Verified behavior |
| --- | --- |
| Guarded HTTP upload | PNG, PDF, text and unknown binary bytes are stored privately; empty MIME values work. |
| Removal and failed admission | Removed IDs cannot launch; rejected requests leave usable staged files. |
| Conditional inputs | A workflow without file fields rejects uploads/attachments; required files cannot be omitted. |
| Limits | HTTP rejects a file over 25 MiB with an actionable error. Unit checks additionally enforce 10 files and 100 MiB total. |
| Claim ownership | Concurrent submissions produce one run. Submitted drafts cannot be reused or recreated by late uploads. |
| Grouped scope | Both app and API repositories reach the launched run and its worktrees. |
| Simulated role | The role receives its manifest/explicit attachment input, reads exact bytes and has the claimed directory in runner read allowances. |
| Restart and retry | A fresh runtime reloads unchanged paths/content; a failed role resumes with retained files after retry. |
| Simple | Its assembled instructions contain canonical paths; the simulated runner reads the submitted text and receives read access. |
| Architecture and nested roles | A behavioral unit check passes files through nested explicit inputs and verifies that candidate asset snapshots contain the exact bytes. |

Run from the repository root:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/media/2026-10-13-launcher-uploads/f1-drive.ts
```

The final non-serving drive returned `result: passed`, stopped its worker and
exited with code 0. Add `--serve` for a headless browser fixture. Uploads use a
native HTTP test client that consumes error responses and closes rejected
connections. The product also closes oversized upload connections after its
413 response.

## Browser verification

The launcher was redesigned after the first captures, which showed a native
file input, stacked file rows and settings expanded inside the composer instead
of the Taskbot reference layout. The current captures come from a fresh headless
Chromium session against an isolated fixture: a grouped `bobs-factory` project
(two repositories), an independent long-named project and simulated agents.

Actual UI actions verified, with no page errors:

- The project name in the heading opens the project menu; grouped projects list
  their members. Typed text and two attached files survived switching to the
  long-named project, and both files were staged again for the new scope (four
  upload requests, both chips `ready`).
- The recipe menu shows each recipe's description. Takeover renders its required
  source field above the prompt and keeps Start disabled until it is filled.
- The sliders button opens Run settings with agent, model, reasoning, service
  tier and execution profiles.
- Enter submitted one `POST /api/runs`; the prompt and chips cleared afterwards.
- An upload rejected with a real 409 response (verified response headers kept,
  outcome simulated) showed a failed chip and its error, and Start stayed
  disabled. A 243-character filename stayed on one ellipsized chip at 390 px.

All six captures were opened and inspected. Hashes are in
[the evidence receipt](media/2026-10-13-launcher-uploads/evidence.json).

![Desktop, light, four uploaded file types](media/2026-10-13-launcher-uploads/desktop-light.png)

![Desktop, dark](media/2026-10-13-launcher-uploads/desktop-dark.png)

![Mobile, dark](media/2026-10-13-launcher-uploads/mobile-dark.png)

![Mobile, light](media/2026-10-13-launcher-uploads/mobile-light.png)

![Rejected upload blocks launch](media/2026-10-13-launcher-uploads/upload-failure.png)

![Long filename stays on one removable chip](media/2026-10-13-launcher-uploads/long-file.png)

## Targeted checks and limitations

Targeted Vitest checks passed **211 distinct tests across 10 files**: launch asset
storage/schema, FactoryServer, FactoryAccess, WorkflowRuntime, repository scope,
web client, execution settings, onboarding and full prompt assembly expectations.
The command environment unsets `GITLAB_BOT_USERNAME`; the host value otherwise
adds unrelated attribution to complete prompt expectations. Earlier combined
runs exposed an HTTP fixture cleanup timeout. One-shot connections now close,
configuration bodies drain, and event streams abort explicitly; the affected
access/server/runtime batch passed all 152 checks, and the remaining batch
passed 58. A final compatibility check added one regression and passed 130
asset/runtime tests: file-field aliases preserve existing step results and ignore
inherited object names.

`pnpm --filter bobs-factory-edge-worker typecheck`, the edge-worker build including
its web bundle, and changed-file Biome checks passed. Biome reports 17 existing
CSS warnings outside the new launcher styles. No dependencies changed.

Agents are simulated. Native model quality and native tool file-format support
are unverified; arbitrary bytes do not imply automatic document parsing. The
embedded CLI fixture logs a handled missing-comment warning during Simple setup;
its attachment assertions and completed execution pass. This drive excludes
publication, merge and real originating-ticket synchronization. Taskbot's
retained `The operation was aborted` synchronization error remains unresolved.

## Merge correction validation

The CI fixer merged base `ef01f788b9132f2eddbbc7c2171634ff9dbc59e8` into
PR #123 from `58b15a882ac59f3ecf7fa13bde0ec284ca761905`. Capability instructions
retain both launcher attachments and the base's frozen workflow, desktop and
notification guidance. Both independently appended FactoryServer tests remain.
The complete routing-prompt expectation includes the combined reference.

The same `F1_AGENT_MODE=mock bun` drive above passed on the combined source,
including exact bytes, grouped scope, claim races, restart/retry and Simple
read access. Its synthetic Simple tracker logged a missing `issue-1` context
warning; the asserted attachment and execution outcomes still passed.
Typecheck, edge-worker/web build and 201 targeted tests passed. Biome and
`git diff --check` passed. Existing screenshots were preserved; this correction
did not repeat browser captures or test real agents. Human acceptance and
fresh pipeline review remain required.

## Redesign and main-merge validation

Latest `main` was merged into the branch. Bundled workflows are now read-only,
so the drive forks the stock Factory launch fields into an `attachment-reader`
recipe instead of rewriting the bundled `factory` definition. The same
`F1_AGENT_MODE=mock bun` drive returned `result: passed` with all eleven
assertions; the known synthetic `issue-1` comment warning remains.

The launcher UI was rewritten (`launcher.tsx`, `launch-uploads.tsx`) and the
browser checks above were repeated against the new bundle. Edge-worker typecheck
and the focused factory suites passed. Biome reports only the 17 existing CSS
warnings.
