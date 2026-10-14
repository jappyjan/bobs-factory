# Desktop update drain CI correction

Date: 2026-10-14. Tested the corrective working tree based on `9d5422f2` for draft PR #117. The correction changes the maintained simulated desktop fixture and its test wrapper; production updater behavior is unchanged.

## Reproduction and cause

CI run 38617191382 stopped producing installation-check output after the desktop runtime test. The Node 22 runner eventually lost communication; Node 24 was canceled after over 100 minutes. Locally, the complete-shell fixture remained in the draining phase with its work lease active.

The updater now holds admission closed and waits for active work to finish. The fixture awaited reconciliation before releasing the lease that prevented reconciliation from completing. Its previous expectation of cancellation was stale after the updater change inherited from main.

## Correction and validation

The fixture starts reconciliation, waits up to five seconds for admission to freeze, confirms the drain is busy and the transaction is still draining, and verifies that the worker and UI identities remain intact with no quit request. It releases the lease independently and awaits successful activation. The existing interrupted-switch recovery, failed replacement rollback, retained checkpoint bytes and bad-candidate suppression assertions remain. The wrapper bounds each child execution to two minutes.

`node --test scripts/tests/desktop-shell-drive.test.mjs` passed both complete drives, including delayed atomic receipt writes. Each child explicitly uses `F1_AGENT_MODE=mock` and a disposable Factory home. The fixture exercises actual protected FactoryServer, WorkflowRuntime, UpdateDrain, capacity leases and desktop lifecycle with scripted UI processes. No real agents, provider credits, native Electron or OS signing are involved.

The complete `node --test scripts/tests/*.test.mjs` installation/publication suite passed all 163 tests on Node 24.20.0 in 38 seconds. Both complete desktop drives also passed on Node 22.21.1 in 10 seconds. Focused Biome and `git diff --check` passed. Historical test-drive evidence is retained unchanged. Hosted CI remains subject to a fresh run after pushing the correction.
