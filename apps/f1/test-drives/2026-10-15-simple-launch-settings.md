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
