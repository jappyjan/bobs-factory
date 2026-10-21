# Final validation for Taskbot bobs-factory #136

Validated source/dependency commit: `754228be98fc3bce92baf349bd74f6b7979d2b8c`.
Production tree is identical to `fdb38ec765a53f00ba71615c1e63089db1883bd0`.
Base/latest main: `a4990127173a9135b331bbe7956559321a0087e2`.
Worktree: `ticket-136-agent-step-recovery`; branch: `t3/ticket-136-agent-step-recovery`.

The final source includes the selected-remote authority correction. Later commits
add only validation fixtures, the replay harness, evidence and changelog links. Production source and
built JavaScript must retain the final drive identity:
`ddc324d3e4094eaaf995ae52566254c6ecda9492b48e5668aa0492a95dc7dcd2`.
The final UI bundle is `1a1a48664aff8c7713ab3375`; screenshot hashes and browser
checks are recorded in [ui-validation.json](../ui-validation.json).

Cleaned lockfile SHA-256: `4d5086fbe1f4c882dd7466a569a75da99817eda5a9adeb89aa7526cc86406e72`.
The [bounded override review](override-review.md) records every removal and retained
upstream constraint. [Before](resolved-before.json.txt) and
[after](resolved-after.json.txt) resolved identity files are byte-identical:
SHA-256 `ba1ea08fbb722db2a6b9ca9d2e10cb1e29410a5c714c3f16dfe600450c139957`.
All 892 locked packages and 950 installed resolved identities are preserved.

## Commands and complete output

| Command | Exit/result | Full output |
| --- | --- | --- |
| `pnpm build` | 0 | [build.log](build.log) |
| `pnpm typecheck` | 0 | [typecheck.log](typecheck.log) |
| `pnpm lint --max-diagnostics=100` | 0; 34 existing warnings | [lint.log](lint.log) |
| `pnpm test:packages:run --maxWorkers=2` | 0; 287 files, 3,672 passed / 2 existing skips | [package-tests.log](package-tests.log) |
| `pnpm -r --filter './apps/*' test:run --maxWorkers=1` | 0; 283 passed, 1 existing desktop skip | [app-tests.log](app-tests.log) |
| `node --test --test-concurrency=2 scripts/tests/*.test.mjs` | 0; 175 passed | [script-tests.log](script-tests.log) |
| `pnpm install` | 0; cleaned override config, unchanged resolved identities | [install.log](install.log) |
| `pnpm audit` / `pnpm audit --json` | 0; zero advisories across 907 dependencies | [audit.log](audit.log), [raw audit JSON](audit.json.txt) |
| `F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/configurable-agent-step.ts` | 0; stock and every-step-renamed Factory completed | [factory-f1.log](../factory-f1.log), [results.json](../results.json) |

Build and typecheck ran through the normal pre-commit hook on the final source.
The complete hook output is retained in
[build-typecheck-hook.log](build-typecheck-hook.log); the two separate logs split
its output at the actual command boundaries without truncating either command.
Lint warnings originate in the unchanged stylesheet and WebhookIpValidator; the expanded diagnostic limit preserves every warning.

## Consequential focused evidence

- [Provider authority and specialist bindings](provider-boundary.log): 69 passed.
  The existing selected-remote security assertion was not edited. The
  [pre-fix complete package output](provider-regression-before-fix.log) records
  the regression: unretained request URLs incorrectly supplied repository
  identity. The final fix accepts retained source/publication or a declared
  draftPr binding; otherwise it selects the configured repository or origin.
- [Desktop fixture durability](desktop-fixture-fixed.log): normal and delayed-write F1 cases both pass after awaiting the existing fixture save. All preservation assertions remain; [the prior sweep](desktop-fixture-before-fix.log) retains the running-to-waiting race.
- [Convergence durability timing](convergence-focus.log): unchanged receipt/convergence assertions pass after the fixture observation allowance changes from five to 30 seconds. The [preceding complete run](convergence-before-fix.log) retains the timeout evidence.
- [Raw historical definitions](legacy-resume.log): 6 passed, including normal
  production loading, restart, question answer and deterministic continuation.
  No test-side registration enables compatibility in these cases.
- [Configuration/rules/binding matrix](config-library.log): 63 passed.
- [Pinned file evidence](file-evidence.log): 3 passed; directory Git objects
  cannot satisfy file existence or file:line references.
- The complete package gate also runs the immutable full-role prompt fixture,
  renamed workflow regression and all previous behavioral assertions.

See the [F1 report](../../../2026-10-21-configurable-agent-step.md) for the
scripted-provider limits, exact tested revision/delta/build digest, retained CLI
activities/comments, and desktop/390px light/dark screenshots. The real worker,
CLI tracker, local Git worktrees/push, evidence checks and explicit approval run;
model reasoning and external provider responses are mocked, with zero paid calls.
No real remote merge or live model-quality claim is made.
