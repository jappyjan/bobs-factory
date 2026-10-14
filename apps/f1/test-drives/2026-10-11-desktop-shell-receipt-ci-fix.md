# Desktop shell receipt race CI fix

**Date:** 2026-10-11
**Base revision:** `6ab8bd0bbd994f28deb7275d2f5ad5540629176b`, with the fixture and regression changes described below.
**Mode:** `F1_AGENT_MODE=mock`; Node 24.21.0. Actual protected Factory API, workflow state, capacity leases, process ownership and update lifecycle; scripted UI processes replace Electron. No real agents or external providers were invoked.

## Failure and correction

GitHub job [114573810408](https://github.com/jappyjan/bobs-factory/actions/runs/38174479136/job/114573810408) passed package tests, then failed the complete-shell drive in the release-script checks. Its polling callback parsed `fixture-ui.json` while a simulated UI child was rewriting that file. The direct write briefly exposed empty JSON and raised `SyntaxError: Unexpected end of JSON input`.

The simulated UI now writes both its identity and health receipts to a process-specific temporary file, then renames it into place. This fixture correction does not alter production lifecycle writes, which already use atomic publication. The existing drive also runs with a preload that pauses fixture receipt writes for 100 ms after truncation. This reproduces the actual reader/writer race without weakening the lifecycle assertions or catching parse errors.

During validation, main advanced to `c7caa8ec` with PR #98's physical-ASAR correction and the same atomic fixture fix. The merge keeps main's fixture writer and all desktop source unchanged from that base, while retaining this branch's deterministic delayed-write regression. Both changelog entries and historical evidence are preserved. The merge's desktop suite passed 34 tests; one pinned-Electron ASAR test was skipped because this checkout has no materialized Electron binary. Main's recorded native acceptance is retained, not claimed as rerun here.

After that merge, the complete release-script suite passed all 144 tests again, with no skips. Both normal and delayed-write complete-shell variants passed against the integrated desktop modules. Evidence: `ci-fix-r13-merged-script-tests.log` and `ci-fix-r13-desktop-merge-tests.log` in the run evidence directory.

## Executed verification

- Before the correction, the delayed-write drive reproduced the CI exception at the polling callback.
- After the correction, that same delayed-write drive passed.
- The maintained regression entry point passed both normal and delayed-write variants during the release-script suite.
- The complete failed CI step's local equivalent, `F1_AGENT_MODE=mock node --test scripts/tests/*.test.mjs`, passed all 144 tests with no skips.
- Both variants assert that an active lease defers app switching without signaling the UI or worker; activation preserves worker identity and waiting state; interrupted replacement recovers the prior UI; a failed shell rolls back without changing worker/checkpoint bytes; and later ticks do not retry the failed candidate.
- Fixture syntax and changed-file Biome checks passed.

The failing CI receipt and local before/after logs are retained in the run evidence directory as `ci-fix-r13-job.json`, `ci-fix-r13-race-before.log`, `ci-fix-r13-race-after.log` and `ci-fix-r13-script-tests.log`.

## Reproduction commands and isolation

Generate the desktop test bundle first:

```sh
bun build apps/desktop/src/update-services.ts --target node --format esm --outfile apps/desktop/src/update-services.mjs
```

Run the maintained drive and its delayed-write regression:

```sh
F1_AGENT_MODE=mock node --test scripts/tests/desktop-shell-drive.test.mjs
```

Local validation set `BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY` to an empty, isolated evidence path. This avoids inspecting the active host's legacy coordinator; production migration checks are unchanged. The drive creates a disposable home, shuts down its server/runtime/capacity pool and scripted UI processes, and removes its test state on successful completion.

## Limits

This validates the maintained simulated desktop drive and cross-process receipt publication. It does not validate packaged Electron, physical devices, signing, real agents or live external delivery. Current-head CI and subsequent reviewer reassessment remain required. Historical test-drive evidence is retained.
