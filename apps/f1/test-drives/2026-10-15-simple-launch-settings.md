# Simple-only launcher settings

**Date:** 2026-10-15
**Result:** Passed with simulated agents and headless Chromium.
**Source:** Base `e9ec4f914fd8ec7745c475941c0afd164a35cc15`, plus this worktree's launcher/capability changes. No commit or publication was performed by the implementation role.
**Fixture:** `media/2026-10-15-simple-launch-settings/f1-drive.ts`

The launcher now offers agent settings only for the launchable workflow whose ID is `simple`. Other workflows keep their step settings from Recipes. Identity and tool profiles remain independent.

## Execution

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker test:run test/FactoryLauncher.test.ts test/FactoryWebClient.test.ts test/FactoryAgentSettings.test.ts test/FactoryExecution.test.ts test/WorkflowRuntime.test.ts test/prompt-assembly.routing-context.test.ts
F1_AGENT_MODE=mock bun run apps/f1/test-drives/media/2026-10-15-simple-launch-settings/f1-drive.ts --serve
agent-browser --headed false --session simple-settings-19a6 open http://127.0.0.1:55566
```

The six targeted suites passed (172 tests at the shared-suite run). After separating supported Simple provider cases and strengthening hidden-form assertions, the launcher suite passed again with 10 tests, replacing its earlier nine. Typecheck, build, changed-file Biome checks and `git diff --check` passed. Initial shared checks could not resolve unbuilt workspace packages; building dependencies resolved those failures without dependency changes.

The fixture created a fresh home and two local Git repositories under `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/simple-settings-f1-VO9zuO`. Its Factory listener used port 55566. HTTP requests used the actual Origin, action, build and configuration guards. Every provider and background title runner was intercepted by `MockAgentRunner`; no inference provider was called.

## Assertions and observations

| Behavior | Evidence / result |
| --- | --- |
| Non-Simple controls | Factory, Takeover and a custom workflow named Simple hid agent controls and separators. Focused tests also covered unknown, disabled, unavailable and non-manual Simple selections. |
| Dialog controls | Simple retained agent/model/reasoning/service-tier controls, and OpenCode exposed its variant. Other workflows showed execution profiles and the Recipes explanation. |
| Stale overrides | Selected Codex model, high effort and fast tier in Simple, then changed recipes. The custom workflow's actual browser launch JSON omitted runner, model, reasoningEffort, modelVariant and serviceTier. Controlled-hook tests supplied all five stale fields directly and verified the same omission. |
| Configuration previews | Factory and custom browser preview JSON omitted runner and model. Both returned the existing Legacy execution preview successfully. Identity and tool profile controls remained usable. |
| Per-step execution | The custom workflow ran Codex/fixture-codex/low/standard, then Claude/fixture-claude/high. Recorded simulated runner configurations matched, including the browser-admitted run. |
| Simple execution | Separate HTTP and browser cases preserved Codex model/high/fast and OpenCode model/custom-review. Provider changes cleared the previous provider's model, effort and tier. |
| Direct API compatibility | An explicit non-Simple API launch still accepted model and reasoning overrides. Step-specific settings continued taking precedence as before. |
| Admission failures | Missing required prompt and disabled selection were rejected through guarded HTTP. Takeover retained its required source field and disabled Start until supplied. |
| Recipe resets | Returning to Simple cleared agent edits. Typed text survived recipe and project switches; the project heading and scope changed together. |
| Attachments | A staged notes.txt survived Simple → custom switching and appeared in the custom launch request. Its claimed manifest belonged to the selected app repository. |
| Live dialog updates | Disabling the selected Simple workflow through guarded HTTP while Run settings was open immediately removed agent controls, keeping the dialog open. Re-enabling restored availability. Changing the saved default to Factory cleared the draft and closed the dialog as the existing form context requires. |
| Navigation/reload | Navigation to Recipes and back cleared typed text and model edits, restored the saved default workflow/project and closed Run settings. Reload also cleared unsent model/effort edits and restored the saved default. |
| Responsive rendering | Inspected all six captures at 1440×1000 and 390×844. Dialog controls and profile previews fit. Simple's narrow composer retains its existing compact agent pill layout. |

A modal prevents ordinary pointer interaction with the recipe menu behind it. Live removal while open was therefore exercised through a real availability update; recipe-change/open-dialog combinations also have focused render coverage. No modal behavior was changed to make an inaccessible gesture possible.

## Evidence

Evidence directory (outside the repository):
`/Users/jappy/.bobs-factory/factory/evidence/manual-05131462-c641-4a6d-b5ba-859819a6f741/`

- `simple-composer-desktop.png`, `simple-settings-desktop.png`
- `simple-composer-mobile.png`, `simple-settings-mobile.png`
- `factory-settings-desktop.png`, `factory-settings-mobile.png` (the mobile image uses the non-Simple custom recipe)
- `browser-requests.json`: captured actual fetch bodies, with no injected response substitution.
- `received-runner-configs.json`: configurations observed by simulated runners.
- `disabled-open-dialog.json`: dialog contents after live availability removal.
- `f1-drive.log`: HTTP drive and simulated execution log.

Saved request evidence was parsed independently: all five forbidden launch keys and both forbidden preview keys were absent; Simple's supported selections and the carried attachment were present. Recorded runner settings were also asserted against the browser selections.

Tested launcher SHA-256: `0218282da65a71d9e33a1c30822bf8cb983bd06a01f9893fb25c10534e5c0b69`.
Tested capability producer SHA-256: `9c1770742c309a2d90b7dd08161835eddc11abcdd3a2b63f4b572606ac4f9824`.

## Cleanup and limitations

Closed only the named headless browser session and stopped the isolated fixture with SIGTERM; worker shutdown completed. Temporary homes and run evidence remain available for inspection. No production configuration, ticket, PR or branch was changed by the fixture.

This proves browser admission and configuration propagation using simulated agents. Real model availability, native effort behavior and explicit credential-backed profile execution were not tested. Profile controls and Legacy previews were exercised. The standalone Simple fixture logs missing synthetic ticket comments and missing source-tree bundled-skills warnings; simulated executions still complete. Real ticket integration is outside this launcher correction.

## Required-check follow-up — 2026-10-17

The combined revision `b170255ff6cad613922896cdbc91be8e886082ce` was checked from a clean worktree. The original eight-suite recovery command completed successfully: 92 tests passed in 119.16 seconds. No assertions or production code were changed. Earlier timed-out runs and the reviewer's combined-suite assertion failure remain historical failures; this run did not reproduce the assertion failure.

The check runner allows 120 seconds per command, leaving almost no margin for this batch. The recovery fixtures use real disk commits; `EdgeWorker.ticket-recovery.test.ts` uses Vitest's one-second default completion wait, while related runtime tests use the existing five-second wait helper. Together with the isolated passing suite, this supports load-sensitive test timing rather than establishing a production recovery defect. Keep every recovery assertion and all eight suites in subsequent verification.

A second complete run with `VITEST_MAX_WORKERS=2` also passed all 92 tests in 123.24 seconds (`fix-r5-recovery-bounded.log`). Limiting workers therefore does not reliably fit the runtime's fixed command budget. The next impact assessment should select the two commands below instead of the monolithic command, retaining the same eight suites. This is an execution-budget correction; neither test assertions nor runtime behavior needs changing.

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Architecture.test.ts test/ArchitectureFootprint.test.ts test/EdgeWorker.architecture-recovery.test.ts test/EdgeWorker.decision-documentation.test.ts test/EdgeWorker.ticket-recovery.test.ts test/Takeover.test.ts test/TicketTracking.test.ts
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts
```

Both split commands passed: the seven-suite command ran 74 tests in 10.07 seconds (`fix-r5-recovery-core.log`), and Impact ran 18 tests in 109.93 seconds (`fix-r5-recovery-impact.log`). Their combined 92 tests match the complete batch, with no omitted suite or assertion. Each command fits the existing 120-second budget on this execution; these timings are observations, not a guaranteed upper bound under future host load.

The previously outstanding checks also passed on that same revision:

- Linear delivery: 15 tests.
- Managed GitHub credentials, with inherited credential variables removed only in the test child: 34 tests.
- Browser dependency source safeguards: 3 tests.
- Biome: all 20 selected executable files; cumulative diff whitespace check passed.
- `F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/role-finalization-recovery.mjs`: passed publication-independent role completion, durable delivery recovery, stale-impact Retry, takeover base, and exact-version acceptance for a 1,024-file architecture proposal. The isolated worker shut down successfully. This used simulated agents.

Receipts are retained in the evidence directory above as `fix-r5-recovery-before.log`, `fix-r5-target-linear-delivery.log`, `fix-r5-managed-credential-coverage.log`, `fix-r5-target-browser-source-coverage.log`, `fix-r5-changed-code-lint.log`, `fix-r5-diff-whitespace.log`, and `fix-r5-target-recovery-f1.log`.

These results cover required runtime checks, not renewed launcher browser QA. Fresh launcher screenshots, simulated-agent launcher QA, and separate recoverable-server-error versus connection-loss QA remain required at their configured later gate. The historical failed preview-abort evidence is retained; it is not relabeled as passing.

## Impact command-budget correction — 2026-10-17

The earlier two-command recommendation above is superseded. The workflow's separate Impact command still exceeded its 120-second limit at clean revision `148842b8fb05b8b52b40f04c19a1f0b9f2b5a7cc`. A fresh verbose run on that revision took 275.62 seconds: 15 tests passed and three reached their 30-second test timeout. The timeouts affected informational comments, approval continuation and grouped repositories; they did not report failed behavioral assertions. Preserve `fix-r6-impact-profile.log` as failed evidence.

The suite repeatedly creates disk-backed workflows and reads paginated context through simulated agents. Verbose timings grew from roughly five seconds for early cases to 15–32 seconds for later cases. Other host test processes were active during profiling. These observations establish an insufficient command budget and timing sensitivity; they do not establish a production defect or prove which host resource caused the slowdown.

Six smaller batches were then run sequentially with a hard 120-second limit per command. Five passed. The batch containing both restart cases failed their ten-second completion wait at Impact.test.ts:866 (received running). Preserve `fix-r6-target-impact-2.log`; do not relabel this attempt as passing. Separating that batch into its non-restart cases and one fresh process per restart case passed in 10.75, 8.40 and 8.14 seconds respectively, without changing assertions, wait durations, production code or fixtures.

For the next independently selected checks, replace `target-impact-tests` with the following **eight separate commands**, each with its own receipt. Do not concatenate them into one shell command. Retain the existing seven-suite recovery command and every other selected check. The final negative pattern is the complement of all preceding groups, so unmatched cases remain included.

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern 'measures actual|rejects stale'
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern 'bounds unchanged|preserves grouped'
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern 'retries stale.*nested=false'
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern 'retries stale.*nested=true'
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern 'recovers selected|inspects a non-mutating|keeps optional'
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern 'accepts shell|preserves original|assesses informational'
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern 'continues explicit|selects and checks|reuses an unchanged'
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts --reporter=verbose --testNamePattern '^(?!.*(?:measures actual|rejects stale|bounds unchanged|preserves grouped|retries stale|recovers selected|inspects a non-mutating|keeps optional|accepts shell|preserves original|assesses informational|continues explicit|selects and checks|reuses an unchanged))'
```

| Impact batch | Passed tests | Command seconds |
| --- | ---: | ---: |
| 1 | 3 | 20.31 |
| 2a | 2 | 10.75 |
| 2b | 1 | 8.40 |
| 2c | 1 | 8.14 |
| 3 | 3 | 75.29 |
| 4 | 3 | 40.68 |
| 5 | 3 | 27.01 |
| 6 | 2 | 13.07 |

The successful batch logs were compared by complete test name against all 18 names in the unfiltered profiling run. Their multiset is identical: each test passed exactly once, with no missing or duplicate case. Filtered commands report skipped tests belonging to other batches; those cases passed in their own commands. This preserves the original 92-test recovery coverage (74 core plus 18 Impact). The maximum observed successful command was 75.29 seconds; timings remain observations rather than guarantees under arbitrary host load.

All other outstanding checks also completed successfully on the same clean revision: combined-target integration, 74 core recovery tests, 15 Linear delivery tests, the simulated-agent recovery F1 drive, 34 managed-credential tests, three browser-source safeguards, lint of all 20 selected executable files and cumulative whitespace validation. The recovery F1 fixture shut down its isolated worker successfully.

Machine-readable execution records and full logs are in the evidence directory above:

- `fix-r6-check-results.json`: original six-batch attempt and remaining required checks, retaining its failed batch.
- `fix-r6-restart-check-results.json`: the three successful replacement commands.
- `fix-r6-passing-checks.json`: successful selection with exact commands, tested revision, elapsed times, exit codes, log paths and the verified 18-test partition.
- `fix-r6-target-impact-{1,2a,2b,2c,3,4,5,6}.log`: successful Impact receipts.
- `fix-r6-target-recovery-tests.log`, `fix-r6-target-linear-delivery.log`, `fix-r6-target-recovery-f1.log`, `fix-r6-managed-credential-coverage.log`, `fix-r6-target-browser-source-coverage.log`, `fix-r6-changed-code-lint.log`, `fix-r6-combined-target.log` and `fix-r6-diff-whitespace.log`.

This correction changes report text only. The configured impact gate must independently select and execute the bounded commands; these local receipts do not manufacture a passing gate. Fresh launcher browser QA and the accepted separate server-error and connection-loss checks remain required at their later gate. Historical failed QA remains retained.

## Main integration validation — 2026-10-18

Integrated target `3843f3bd2804e2f5502698b1502a35d4885f8677` into
`be48649d34084e69e80710507d6fb985f6a6d7f7`. The tested staged tree was
`f8ab49fb360e3ab1649cdc81ce945ad98334e751`; this report addition is the only
subsequent change. Resolved the changelog and capability-reference conflicts
by retaining both branches' entries, Simple-only launch settings, the target's
show-and-tell description and guide schema, and the complete prompt expectation.

Build, workspace typecheck, five-file Biome checking and whitespace checks passed.
The selected launcher/integration command passed all 301 tests. Guide, review
brief, workflow catalog, feedback policy and capture-recovery suites passed all
86 tests. That five-suite command took 128.62 seconds, beyond the workflow's
120-second command limit. Future impact selection should run
`test/EdgeWorker.capture-recovery.test.ts` separately from the other four suites,
preserving every test and assertion.

The new original-source regression initially reached its 30-second test timeout.
An isolated diagnostic run with `--testTimeout=90000` passed in 15.68 seconds;
the original command then passed with its unchanged default timeout in 7.87
seconds. Both failed and passing logs remain recorded. This establishes timing
variation, not a demonstrated production defect.

The 34 managed-credential tests passed after removing inherited credential
settings only from their test child. In addition to the earlier command's
`BOBS_FACTORY_HOME` and `BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND`, unset
`BOBS_FACTORY_GITHUB_MANAGED_CREDENTIALS`, `BOBS_FACTORY_GITHUB_REPOSITORIES`,
`BOBS_FACTORY_GITHUB_TOKENS` and `BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS`.
The initial command's six repository-scope failures remain recorded; production
scope enforcement and all fixture assertions are unchanged.

All three simulated-agent F1 drivers passed: the launcher driver above,
`apps/f1/test-drives/assets/impact-feedback-recovery.mjs`, and
`apps/f1/test-drives/assets/review-story.ts` (with
`BOBS_FACTORY_INTERNAL_EXECUTABLE` unset). The guide fixture also rendered in a
fresh headless browser: six slides, collapsed evidence and explicit approval
still required. Its screenshot was inspected; the browser and fixture stopped.

Logs and the screenshot are in the retained run evidence directory under
`ci-fix-r10-*`. These checks validate the integration, not the later fresh
launcher browser QA or human acceptance. No real agents or provider credits
were used. Historical failed QA remains retained.

## Combined-revision verification correction — 2026-10-20

Tested clean revision `8c3f4cb4cfedf100d9fa942905fc469ad07d36bb`, including
target `b963ba106028e0af8aacfb89558048051a372fe4`. No production code changed.
The saved-review fixture parsed the context snapshot manifest as role input;
the manifest now contains references rather than the complete input. A retained
replacement fixture uses the exported `loadFactoryContextSnapshot` loader.
Every assertion and the saved workflow graph remain unchanged. The original
fixture and failed runtime receipt remain available.

Use this replacement command for `target-review-stage-f1`:

```sh
F1_AGENT_MODE=mock node /Users/jappy/.bobs-factory/factory/evidence/manual-05131462-c641-4a6d-b5ba-859819a6f741/fix-r13-review-stage.mjs
```

It passed inventory, coverage, QA and acceptance routing. Acceptance remained an
unanswered human wait; restart retained the graph and history without replaying
roles or inventing approval. The isolated worker stopped successfully.

All 22 previously unexecuted selected checks also passed. The API responsiveness
fixture first failed because the inherited internal executable tried to run a
missing `internal` script. Removing that override only from its child process
passed with unchanged assertions. Retain this replacement command:

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/api-responsiveness.ts
```

The 23 fresh successful receipts cover the replacement saved-review drive,
launcher, update draining, impact recovery, guide generation, architecture
continuation, API responsiveness, bounded-memory context delivery, operator
submissions, incomplete-review recovery and Linear simulations; configuration,
activity, persistence, execution, core snapshot, MCP transport and CLI tests;
nightly evidence checks, lint and whitespace validation. Commands ran
sequentially, each within 120 seconds. No provider inference was used.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-05131462-c641-4a6d-b5ba-859819a6f741`.
`fix-r13-passing-checks.json` records all 49 unique successful selections:
26 original runtime receipts retained at their original revision and 23 newly
executed commands. `fix-r13-check-results.json` preserves the failed API attempt;
`fix-r13-replacement-results.json` records its successful replacement and the
remaining commands. `fix-r13-fixture.patch` and
`fix-r13-review-stage-receipt.json` record the exact loader correction, fixture
hashes, passing log and isolated fixture home. Full logs use `fix-r13-*` names.

Only this existing report is changed in the repository. The configured impact
assessor must adopt the two replacement commands and obtain its own runtime
receipts; these local executions do not claim that gate has run. Fresh launcher
browser QA and delivery approval remain obligations of their later gates.
Historical failures remain retained; no merge or ready transition was performed.


## Isolated recovery and authentication integration — 2026-10-20

Integrated target `cfc307cb8f701bfb7946b4122d06680bc7cb1037` in merge revision
`11b9986b7d2b9ce671a2292649fece3094b74c1a`. Both changelog histories remain.
The resulting tree matches the independently calculated combined tree
`3515bb445ebec6b046509e6ed41f076f54fd92c9`.

The selected recovery drive previously failed before its assertions because
shared port 3600 was occupied. A retained replacement allocates two distinct
OS-assigned ports and updates its request URLs and origins consistently.
Only imports and port setup differ; assertions, timeouts, simulated handlers
and worker cleanup are preserved. Use this replacement for `target-recovery-f1`:

```sh
F1_AGENT_MODE=mock bun /Users/jappy/.bobs-factory/factory/evidence/manual-05131462-c641-4a6d-b5ba-859819a6f741/ci-fix-r16-role-recovery.mjs
```

It passed fresh/saved role completion, durable publication recovery, stale-impact
retry, takeover base preservation and the 1,024-file architecture acceptance
wait. Its original source remains unchanged. `ci-fix-r16-role-recovery.patch`,
`ci-fix-r16-recovery-receipt.json` and `ci-fix-r16-role-recovery.log` retain the
exact replacement, fingerprints, tested revision and successful shutdown.
The replacement uses isolated ports rather than the shared 3540/3600 resources.

The new target's authentication integration also passed all seven server checks:

```sh
env -u F1_DEVICE_HOLD F1_AGENT_MODE=mock F1_DEVICE_PORT=3690 bun run apps/f1/test-drives/assets/device-pairing-approval.ts
```

This exercised trusted approval, receiving-browser cookie binding, concurrent
single-use key collection, persistent login, a protected scripted launch and
read, key revocation and recovery after the real throttling window. Worker and
listeners stopped. The complete receipt is in `ci-fix-r16-device-pairing.log` in
the same retained evidence directory. This server-only execution uses simulated
agents; it does not claim fresh browser screenshots or real-provider behavior.

The launcher drive also passed required-input and disabled-selection admission,
two configured steps, Simple effort/tier and variant propagation, and direct API
override compatibility. Its worker stopped; `ci-fix-r16-launcher-f1.log` retains
the assertions and cleanup.

All 383 tests passed across the 14 selected launcher, execution, credential,
authentication and recipe suites with one Vitest worker. The structured receipt
`ci-fix-r16-tests.json` records zero failed or skipped tests. The first run exited
zero but had no test summary, so only the structured rerun establishes the count.
Workspace build and typecheck passed. The configured impact checks must adopt
the replacement recovery command and obtain their own current-revision receipts.
All 50 selected checks, fresh specialist review, launcher browser QA and human
delivery approval remain required at their configured gates. Earlier executions
and failures retain their original provenance; no merge or ready transition on
GitHub was performed.


## Merge validation against main on 2026-10-20

Merged target `dd0b591a` into launcher head
`ee4a9c1a3410b21dd9dec2cec920e3263bae9522`. The only conflict was
`CHANGELOG.md`; both launcher corrections and the target recovery entry remain.
The tested combined source tree before this report addition was
`922b724896ebb60d90989f635bec28c01e3c3032`.

`pnpm build`, `pnpm typecheck`, `pnpm biome ci` and whitespace checks passed.
Biome reported 25 warnings. The affected test command passed 12 suites and
373 tests:

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker exec vitest run \
  test/FactoryLauncher.test.ts test/FactoryAgentSettings.test.ts \
  test/FactoryWebClient.test.ts test/RunnerConfigBuilder.github-token-env.test.ts \
  test/prompt-assembly.routing-context.test.ts test/Architecture.test.ts \
  test/CISupervision.test.ts test/SpecialistReview.test.ts \
  test/WorkflowRuntime.test.ts test/WorktreeRecovery.test.ts \
  test/EdgeWorker.capture-recovery.test.ts test/EdgeWorker.merge-recovery.test.ts
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/stuck-run-recovery.mjs
```

The target adds runtime recovery behavior, so F1 applies to the combined revision.
The recovery driver passed all ten assertions, including retained architecture
questions, explicit acceptance, worktree restoration, correction after green CI,
merged-delivery reconciliation and stale-impact reassessment. It used simulated
agents and a read-only scripted provider. Its isolated directory was
`/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-stuck-recovery-A7uryE`;
fixture servers stopped successfully. No real inference provider was called.

Logs are retained in the evidence directory above as `ci-r19-build.log`,
`ci-r19-typecheck.log`, `ci-r19-tests.log`, `ci-r19-lint.log` and `ci-r19-f1.log`.
This validates recovery integration; it does not replace fresh launcher browser
QA, independent impact review, provider CI or human approval for the new revision.
Historical results and failed evidence remain unchanged.

## Review verification follow-up on 2026-10-20

At source revision `7860f51d8dd5618df2aeff752d00c3bce2a66353` against target
`dd0b591a480593d6b9952b0e1e5acadba574ee23`, the original guide-test port
collision no longer reproduced. Ports 3542 and 3602 were available, and the
unchanged selected command passed:

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/review-story.ts
```

Its success marker records both new-guide and saved-guide upgrade assertions,
preserved model settings, and pending human approval. The worker and shared
listener stopped. No service was stopped to obtain these ports, and no fixture,
assertion, command or production source was changed.

Executed all 26 subsequent selections sequentially with simulated agents where
applicable. Twenty-two passed, including context transport, bounded-memory
context handling, API responsiveness, device pairing and revocation, recovery
tests, CLI and desktop helpers, workflow lint and release safeguards. Together
with the original 30 passing runtime receipts and the guide rerun, the inventory
contains 53 passing commands out of 57. Original receipts retain their original
provenance; they were not rerun or assigned new execution dates.

Four drives remain blocked by occupied listeners:

| Selected command ID | Occupied port |
| --- | --- |
| `target-architecture-continuation-f1` | 3600 |
| `target-operator-context-f1` | 3601 |
| `target-incomplete-review-f1` | 3600 |
| `target-stuck-recovery-f1` | 3600 |

`lsof` and `ps` identify both listeners as PID 92802, running
`bun apps/f1/test-drives/media/2026-10-20-improve-codebase/live-drive.ts` in
the separate worktree `/Users/jappy/.t3/worktrees/bobs-factory/t3-a8e35145`.
The process remained active at the final listener check. It was left running:
the review findings explicitly require preserving unrelated services. The
listener owner must release these resources before the unchanged commands can
be retried. Changing their fixtures or commands instead requires independent
impact reassessment before execution.

Evidence remains under
`/Users/jappy/.bobs-factory/factory/evidence/manual-05131462-c641-4a6d-b5ba-859819a6f741/`:

- `fix-r14-verification-inventory.json` binds all 57 selections to passing or
  blocked receipts and preserves the original guide failure.
- `fix-r14-selected-checks.json`, `fix-r14-original-receipts.json` and
  `fix-r14-fresh-receipts.json` retain exact commands and execution results.
- `fix-r14-<command-id>.log` retains each fresh execution's complete output.
- `fix-r14-port-owners.txt` records the unrelated listener owner.

All six current verification findings remain open because four required drives
lack passing receipts. This report does not establish code readiness or waive
fresh QA, independent review, provider readiness, human acceptance or confirmed
merge. The desktop helper suite exited zero with one skipped test; lint retained
25 warnings. No real inference provider was called. This follow-up changes only
the report; the original failures and historical QA remain preserved.

## Dynamic-port correction on 2026-10-20

The Factory operator (name not recorded) answered the listener question at
`2026-10-20T20:23:53.389Z`: “make it so test runs use dynamic ports and dont
collide.” Source: `/workflowExecution/answers/5`. This authorizes the fixture
correction; it does not waive verification or delivery gates.

Added `apps/f1/src/ports.mjs`, which asks the OS for available ports and reserves
both IPv4 and IPv6 loopback listeners through fixture setup. It retries an IPv6
port conflict, supports hosts without IPv6, and closes reservations on allocation
failure. Each fixture releases its reservation immediately before worker startup
and retains its chosen ports through restart. This follows the existing launch
fixture's reservation/handoff pattern, with both address families reserved.
There remains a short release-to-bind handoff; the worker does not inherit the
reservation socket. Production listener behavior is unchanged.

Six selected drives now use the allocated ports consistently in their worker
configuration, Factory origin, HTTP requests and F1 CLI environment:

- `review-story.ts`
- `architecture-approval-continuation.mjs`
- `frozen-workflow-approval-context.mjs`
- `ci-fix-incomplete-review.mjs`
- `stuck-run-recovery.mjs`
- `impact-feedback-recovery.mjs`

Each prints `F1_PORTS` for debugging or an optional held dashboard. Existing
behavior assertions, approval waits, simulated agents and worker cleanup remain.
The final drive was included because it also used the shared 3540/3600 pair.

All six drives passed using their existing selected commands. During execution,
the validation wrapper held every available former port in the set
3540, 3541, 3542, 3600, 3601, 3602 and 3604. Existing listeners were left alone;
the wrapper closed only its own listeners afterward. All six drives selected
different ports. The five initially affected drives passed at code commit
`e980c57f`; the additional impact-feedback drive passed at `4803dfc7`.

The two allocator regression tests passed: simultaneous fixture reservations
remain distinct and exclusive, release permits worker rebinding, repeated cleanup
is safe, another listener remains active, and invalid counts reject. The first
test attempt exposed macOS's separate IPv4/IPv6 binding behavior; explicit
reservations for both families corrected it. Build and typecheck passed in the
required commit hooks. Changed-file Biome, helper syntax and whitespace checks
passed.

Evidence in the retained run directory:

- `fix-r15-drive-receipts.json` and `fix-r15-impact-drive-receipts.json` record
  exact commands, tested revisions, allocated ports and occupied former ports.
- `fix-r15-<command-id>.log` contains each complete drive execution.
- `fix-r15-commit-checks.log` and `fix-r15-impact-commit-checks.log` contain build
  and typecheck results.
- `fix-r15-dynamic-ports.patch` retains the fixture/helper correction.
- `fix-r15-verification-inventory.json` contains six fresh passing receipts and
  51 earlier passing receipts covering all 57 selected command IDs. Earlier
  receipts retain their original revisions and provenance; they are not claimed
  as 57 fresh executions of this revision. The prior failures remain retained.

The listener blocker is corrected without stopping unrelated services. Independent
impact assessment must reassess the changed fixtures, remove their obsolete
fixed-port resource declarations, determine which original receipts can be
reused, and obtain required runtime receipts. These local correction results do
not approve that gate. Fresh launcher QA, provider readiness, human acceptance
and confirmed merge remain required. No real inference provider was called.
