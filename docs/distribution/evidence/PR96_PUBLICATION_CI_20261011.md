# PR96 publication CI correction

[PR96](https://github.com/jappyjan/bobs-factory/pull/96), [Taskbot116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116).
Failed CI head: `88a9b1f61e0c8082a242c2e32c669583c869e363`.
Tested correction: `3ae15485963261f10d110b121a216cbb3fe806b0`.
The subsequent commit adds only this report and new raw evidence. Work remains in
`/Users/jappy/code/jappy/bobs-factory-unsigned-review-96`; root/original checkouts,
previous implementation evidence and independent review reports are untouched.

## Diagnosis before correction

[Original failed CI log](pr96-publication-ci-20261011/ci-original.log.raw),
[run38168182020](https://github.com/jappyjan/bobs-factory/actions/runs/38168182020):
Node22 had 140 pass, one failure and one skip; Node24 was cancelled. The failing
partial-upload recovery test accepted any nonzero first-publisher result, then read
`partial.release.draft` without confirming the injected upload fault was reached.
The log contains no first-publisher stderr, so its original child message cannot
be recovered from that log.

Inspection found that `release-publication.test.mjs` and
`unsigned-release-flow.test.mjs` launch separate publishers against distinct local
simulated provider states, but inherit one shared temporary-directory repository
publication lock. An unrelated fixture can therefore prevent draft creation.
This is a fixture isolation defect; production exclusion is correct.

Using actual Node22 v22.21.1 child processes and a shared owned temporary directory,
the unchanged partial-upload test from an archive of exact failed head88a reproduces
the same undefined-`draft` error while another process holds the lock.
[Exact old reproduction](pr96-publication-ci-20261011/old-held-lock.log.raw).
Adding the precise fault assertion exposes publisher exit1 and stderr:
`Another publication or interrupted publisher owns ...` before provider mutation.
[First-result diagnosis](pr96-publication-ci-20261011/diagnostic-held-lock.log.raw).
[Reproduction controller](pr96-publication-ci-20261011/held-lock-repro.mjs.raw).

An unforced two-file concurrent run passed31/31 before correction, illustrating
why an unchanged rerun alone is insufficient evidence for this scheduling race.
The held-lock experiment deterministically demonstrates the failure mechanism;
it does not invent missing stderr from the historical CI run.

## Minimal fix and retained guards

Each simulated publisher now passes `TMPDIR: f.work`, so independent mock providers
have independent lock/snapshot namespaces and retries against one provider keep the
same namespace. Explicit temporary-directory overrides for upload/snapshot checks
still work. No production lock, publisher, inventory, snapshot, recovery, workflow,
quarantine or runtime code changed; no timeout was increased or retry added.

The partial-upload test now requires exit1 and the actual injected
`upload-before:candidate.json` error before reading draft/partial assets. Unexpected
early failures show their real stderr instead of passing as intended upload faults.
Its original missing-only upload and synchronization-only recovery assertions remain.

A durable actual-publisher regression holds an unrelated fixture's lock while
publishing to its own simulated provider. It fails before isolation with the lock
refusal, and passes fixed with a complete public fixture inventory.
[Red](pr96-publication-ci-20261011/isolation-red.log.raw),
[green plus existing same-lock exclusion/recovery](pr96-publication-ci-20261011/isolation-green.log.raw).
The production overlap/refusal and release-after-failure test is unchanged.

## Verification

- Node22: `node --test --test-concurrency=4 scripts/tests/*.test.mjs`: **143/143 passed**, zero skips. All files run with a shared owned parent temporary directory, including concurrent publication, immutable snapshots/upload races, partial/chunk recovery, wrong/corrupt artifact refusal, beta snapshot checks and the maintained mock complete-shell F1 driver.
- Node24: concurrent publication/unsigned-flow suite **32/32 passed**.
- Exact correction Node22: isolation, partial upload/Pages recovery, same-lock refusal and unsigned publisher→discovery→offline reconstruction→update/rollback **4/4 passed**.
- Biome, diff check and normal source commit lint-staged/build/typecheck hooks passed.

These local Node22 checks ran on macOS with shared-directory/process concurrency,
not a Linux VM. A Docker daemon was unavailable and was not started. Linux CI binds
the next pushed exact head; prior failed or passing heads are not final-head CI.
Native product builds, publication/dispatch, production services/installations,
merge and Taskbot closure remain unauthorized and were not performed.
[Raw check inventory](pr96-publication-ci-20261011/checks.json.raw).

The [retained helper correction](PR96_HELPER_CLOSURE_20261011.md) and previous unsigned,
quarantine/beta/F1 evidence remain unchanged. The user's no-paid-signing decision,
candidate-bound SHA256/size integrity, native stores/attribution and explicit per-app
OS allowance remain the full review scope. Root owns fresh independent Standards/Spec
review using the original brief, all prior reports and these responses. This report
is implementation evidence, not approval, native first-launch acceptance or release.
