# Architecture approval integrated with current main

Date: 2026-10-11. Taskbot #90, PR #74.

Tested merge working tree: PR parent `6c7f79c33b19622e43331c588bccaedac3399467`
with main parent `c7caa8ec`. This report supplements the earlier architecture
reports; their original observations and screenshots remain historical evidence.

## Changed behavior and applicability

F1 applies to the integrated planning and execution path. Independent plan
review validates the exact delivery contract before routing. Repository work
then enters architecture proposal, architecture review and exact human
acceptance. Mixed delivery first applies/verifies ticket changes and then enters
architecture approval before coding. External-only work retains its independent
external review without requiring a repository architecture proposal.

Untouched saved stock recipes with delivery routing gain the architecture gate
without losing their contract reviewer. Custom planning paths and accepted run
snapshots remain preserved. The protected chat route retains architecture
feedback and delegates other steering to the shared operator service. Both
architecture and review-brief styles are retained.

## Executed F1 drive

```sh
BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY=$(mktemp -d) F1_AGENT_MODE=mock \
  bun apps/f1/test-drives/media/2026-10-11-architecture-decision-brief/f1-drive.ts
```

Exit 0. Five scenarios passed using real EdgeWorker orchestration and mocked
agents in isolated local repositories:

- Factory and Takeover meaningful proposals reject acceptance with an open
  choice; explanation and restart preserve the gate; revisions invalidate old
  acceptance; exactly one implementation follows acceptance of version 3.
- Both workflows bypass additional human architecture waits for routine work.
- A revision without a change list exhausts output correction and cannot record
  version 2 or authorize implementation.

The fixture now supplies the stock repository delivery contract and its exact
review digest, retains all workflow targets while stopping after implementation,
and checks the implementer receives the frozen delivery context alongside the
accepted plan. An initial probe expected only plan/answers; it failed on the
new required delivery fields. The fixture assertion was corrected and all five
scenarios reran successfully. Log: `/tmp/pr74-merge-f1.log`.

## Other verification

- Focused initial checks: 277/278 passed. The mixed-correction fixture lacked
  architecture handling. Its updated regression proves corrected ticket state
  survives while repository implementation waits for explicit architecture
  acceptance; subsequent architecture/delivery runs pass 40/40.
- Edge-worker suite: 1929 passed, one skipped, 13 video tests fail at fixture
  setup with `spawnSync ffmpeg ENOENT`. No other failures. This machine lacks
  FFmpeg; CI installs FFmpeg/jq in `.github/workflows/ci.yml`. The local full
  suite is not claimed as passing. Log: `/tmp/pr74-merge-fulltests.log`.
- Workspace build and typecheck pass. The final edge-worker build verifies the
  updated stock-recipe compatibility code. Repository lint passes with 19
  warnings; whitespace checks pass.
- Saved-stock upgrade regression validates the combined workflow definition
  and preserves separate delivery and architecture reviewers. Existing tests
  cover frozen-run preservation and operator-customized planning.

## Limits

Agents and forge inspection are mocked; no provider-credit usage, production
tracker mutation, remote delivery or real-agent design quality is claimed.
No new visual layout was introduced by this integration. Existing architecture
and review-brief screenshot evidence remains at its original revision; it is
not a fresh browser walkthrough of this merge.

## Latest main integration

Main advanced during validation to `599a67d12cb204de7e6c5387b83e6d05e28b659e`
(PR #99). The follow-up merge preserves direct same-origin localhost access
and HTTPS passkey protection. Capability prompts and their full-string test
expectations retain both localhost and architecture behavior.

The architecture HTTP regression now uses an explicit HTTPS origin and remote
peer with a fixture session. It proves anonymous rejection, stale/duplicate
rejection, discussion regeneration and valid exact-version acceptance. The
shared test fixture accepts an optional origin; its existing default is unchanged.
The initial localhost denial assertion was incompatible with the new local
operator contract and was corrected to test the protected remote surface.

The same five-scenario F1 command reran against this final merge tree and exited
0 (`/tmp/pr74-latest-main-f1.log`). Final focused validation passed **113 tests in
8 files**, covering architecture, remote/local access, server, onboarding,
ticket delivery, web client, full routing prompts and machine capacity.

The broad rerun before the HTTP fixture correction recorded 1932 passes, one
skip and 15 failures: 13 missing-FFmpeg fixture failures, the obsolete localhost
assertion, and a macOS capacity-lock `readlink EINVAL` in the concurrent
cross-process test. The corrected HTTP check and all capacity tests passed in
the final focused run; no capacity implementation was changed. A clean full
suite with FFmpeg is still delegated to CI. Logs:
`/tmp/pr74-latest-main-tests.log`, `/tmp/pr74-latest-main-targeted.log`.

Workspace typecheck and repository lint pass on the combined sources (19 lint
warnings). The commit hook builds and typechecks the entire workspace. No
production tracker writes or real agents were used in either F1 run.
