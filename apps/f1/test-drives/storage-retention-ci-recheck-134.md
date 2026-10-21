# Storage retention: runtime recheck and base integration

Date: 2026-10-21. PR: [#164](https://github.com/jappyjan/bobs-factory/pull/164).
Tested source: `562df798cffa3ebbe0d6fa0cb73238df7d6c91b6`.
Integrated target: `a4990127173a9135b331bbe7956559321a0087e2`.
Previous reports and failed receipts remain unchanged.

## Runtime blocker cleared

The installed runtime now identifies commit `a4990127`. Inspection of that
revision confirms a shared twenty-minute command deadline, including selected
checks and command hooks. This replaces the two-minute call documented in the
previous report. No new human answer was supplied; the changed installed build
and source establish that the earlier assistance condition is cleared.

The target had advanced and introduced five conflicts. Resolution retains both
capability descriptions and complete prompt assertions, uses the shared command
deadline, and preserves full worker shutdown in ticket-recovery fixtures.

## Concrete CI failure and correction

The first combined-tree workspace run at `39453723` completed in 274.484 seconds
with one capacity-test failure: `readlink` returned `EINVAL` during concurrent
coordinator initialization. The unchanged focused suite subsequently passed all
18 tests. A separate real-filesystem probe then reproduced `EINVAL` while four
contenders created and removed only symlinks. Follow-up inspection found either a
symlink or an absent path; no regular files were published by the probe.

Capacity acquisition now retries that condition only when the path is still a
symlink or has disappeared. Every attempt remains inside the existing acquisition
deadline. Unknown regular files fail closed and remain untouched. Three public
coordinator regressions exercise removed and replaced links, continued exclusion
by a live replacement owner, and rejection of a foreign regular file. All 21
focused capacity tests passed before the final full run.

## Executed validation

The selected sanitized workspace command ran through production FactoryTools and
selectedChecks at clean, unchanged source `562df798`. It completed successfully in
229.755 seconds: **3,926 Vitest tests and 41 desktop tests passed**, with three
optional skips. This includes 2,356 edge-worker tests, 243 CLI tests, 140 Codex
tests and all 17 F1 tests. Build and typecheck passed through the required commit
hooks. Final Biome passed with 34 non-fatal warnings. All 175 installation and
publication safeguards passed separately.

F1 used simulated agents, isolated homes/repositories and controlled delivery.
The eight storage scenarios exercise native-continuation preservation, actual
Resume/deletion exclusion, five delivered workflow routes, retained cross-run
file and symlink dependencies, realistic saved build receipts, and five update
cycles. They preserve authoritative state and protected content while removing
only eligible data. Stock delivery scenarios resume retained reviewed checkpoints;
they do not manufacture fresh planning, human approval or real-provider behavior.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-9a020f41-9844-4a38-b17b-977a1ed1973d/`.

- `ci-fix-r4-runtime-timeout.json`: observed installed build and deadline source.
- `ci-fix-r4-selected-check.json`, `ci-fix-r4-workspace.log`: original failed run.
- `ci-fix-r4-symlink-probe.mjs`, `ci-fix-r4-symlink-probe.json`: filesystem reproduction.
- `ci-fix-r4-capacity.log`, `ci-fix-r4-capacity-fixed.log`: focused investigation.
- `ci-fix-r4-final-selected-check.json`, `ci-fix-r4-final-workspace.log`: completed passing workspace result.
- `ci-fix-r4-final-biome.log`, `ci-fix-r4-final-install-guards.log`: final quality and installation checks.

## Remaining workflow obligations

The local execution does not rewrite the managed independent check gate. Its
fresh execution, specialist review, Storage UI QA, human acceptance and
provider-confirmed delivery remain the pipeline's responsibilities. Real-provider
continuation and native behavior on other platforms remain unverified. The
follow-up after the tested source adds this report only.
