# PR96 retained helper correction

[PR96](https://github.com/jappyjan/bobs-factory/pull/96), [Taskbot116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116).
Old reviewed head: `3e597d0b70ea3a8a169d14576440b3eabd5ab747`.
Tested implementation: `493167cd72ba961c758e636fd79e0d8979f17469`.
Isolated app-owned checkout: `/Users/jappy/code/jappy/bobs-factory-unsigned-review-96`.
The following evidence commit changes only this report and new raw evidence.
Root/original implementation checkouts and all prior report bytes are untouched.

## Round2 P1 response

[Immutable original Spec report](pr96-helper-closure-20261011/spec-round2.md.raw),
SHA256 `c4f2e7ccfbc023c054b83ccde9bd6f948aade941334140c8381b88b52d4fe0b0`.
The supplied round2 Standards result was APPROVE/no findings, with supplied SHA256
`03901f47690d00ecb744e38da3f002ef88e5577cbcd223029cc69be431daf5b0`.
Both reviews were terminal before implementation. Fresh independent Standards/Spec
review must assess the full original unsigned decision and all prior objections;
this report is implementation validation and does not replace that review.

The supplied actual `appUpdates.action()` reproduction was run unchanged at the
old head: enrollment, discovery and Install staged successfully, but the retained
helper exited 1 with `ERR_MODULE_NOT_FOUND` for `app-quarantine.mjs`. No activation
transaction existed and the old installed bytes remained intact.
[Reproduction](pr96-helper-closure-20261011/reproduction.log.raw).

Production Install/retry, automatic tick and recovery share the same handoff.
It and the native-shell fixture now use `retainAppHelper`, which copies the full
runtime closure including quarantine and the bundled `update-services.mjs` outside
the app being replaced. The native fixture no longer duplicates a partial list or
redirects services imports back into the original app. The materializer itself is
used before spawning; the retained helper does not import it.

The actual helper, lifecycle, source, archive, licenses and quarantine imports were
audited recursively. They resolve to the copied modules and Node built-ins; services
are the existing self-contained bundle. Search found no other maintained external
helper materialization paths. Desktop packaging includes `src/**`; repository-side
source/preparation consumers resolve the new module in place.

## Consequential regression and checks

`apps/desktop/test/app-helper.test.mjs` invokes the production actions through a
separate scripted UI process. One check executes the retained helper in another
subprocess with recovery and requires successful module linkage/execution. The
second uses real Install consent, discovery, staging and detached helper activation,
requires the exact UI quit ticket, then checks retained previous bytes, installed
fingerprint, candidate manifest identity, launched PID/stamp health and acknowledged
maintenance release. Fixture processes are identity checked and stopped before
deleting their temporary state. Transport/native release evidence is simulated;
the activated executable is a Node script, not native Electron.

Both committed tests fail against production from an isolated archive of exact
`3e597d0b`, then pass with the fix. No source-text copy-list assertions are used.
[Red](pr96-helper-closure-20261011/helper-red.log.raw),
[exact committed green](pr96-helper-closure-20261011/exact-green.log.raw).

- Desktop suite: **34/34 passed**, including all three actual macOS quarantine/filesystem byte-identity cases, integrity refusals and recovery/rollback safeguards.
- Exact implementation focused checks: **9/9 passed** (helper2, quarantine3, beta4), zero skips.
- Maintained complete-shell mock F1 driver: **all five assertions passed** at exact implementation, preserving worker ownership/checkpoints, idle deferral, interrupted recovery, failed replacement rollback and bad-candidate suppression. [Receipt](pr96-helper-closure-20261011/shell-green.json.raw).
- Beta snapshot and executable F1 regression suite: **5/5 passed**. Native fixture syntax, Biome and `git diff --check` passed. Normal source commit hooks passed lint-staged, ordinary build and typecheck.

The first broader test run exposed the new test observing `succeeded` before the
existing asynchronous maintenance-release acknowledgment. The test now waits for
that actual acknowledgment before asserting fence cleanup; production transaction
semantics are unchanged. [Initial test-boundary result](pr96-helper-closure-20261011/desktop-test-boundary.log.raw).
[Raw check inventory](pr96-helper-closure-20261011/checks.json.raw).

The [original unsigned validation](../../../apps/f1/test-drives/2026-10-11-unsigned-delivery.md)
and [round1 correction evidence](../../../apps/f1/test-drives/2026-10-11-unsigned-review-fixes.md)
remain immutable. Candidate/inventory/source-chunk/publication-race/stable provenance,
beta approval snapshot, per-app quarantine and native credential-store protections
remain intact. Paid Apple/publisher signing remains superseded by the user.

This scoped check is not quarantined native first-launch/Gatekeeper acceptance.
No quarantine clearing, global OS protection change, paid signing, native build,
new freeze/dispatch, live provider, real publication, production installation/service
change, merge or Taskbot closure was performed. Future first launch must retain the
explicit per-app OS permission boundary.
