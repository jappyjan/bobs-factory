# Configure SSH agents with Git identities

The final UI is **Settings → Identity profiles → Host Git identity**. Explicit
signing and repository SSH bindings reuse the same selector and connection test.
The original standalone-page validation below is retained as historical evidence;
see the final consolidation validation at the end for the shipped UI.

Validated on 2026-10-15, starting from `e9ec4f914fd8ec7745c475941c0afd164a35cc15`
with this branch’s implementation changes. F1 applies to the new authenticated
Settings workflow and retained-run Git execution. The served dashboard build was
`291be13e617423a43b576eab`.

## Scenario and execution

The embedded F1 EdgeWorker uses `f1AgentHandlers("mock")`, a fresh temporary home
and repository, two disposable real SSH agents, and a generated fixture key. One
agent is empty and inherited by the worker; the other holds the signing key.
A custom workflow runs a real signed Git commit. No live model inference,
production run mutation, hosted Git publication or native credential changes occur.

```sh
pnpm install --frozen-lockfile
pnpm build
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/tmp/bobs-factory-git-agent-evidence \
  node --experimental-strip-types apps/f1/test-drives/assets/git-agent-settings.ts
F1_EVIDENCE_DIR=/tmp/bobs-factory-git-agent-evidence \
  node apps/f1/test-drives/assets/git-agent-settings-browser.mjs
```

Both new Settings endpoints returned 401 for signed-out remote requests. The
fixture launched its workflow through the protected loopback API, prepared a real
worktree, and failed with `Couldn't find key in agent`, reproducing the reported
failure before changing the setting.

The browser drive passed all 12 assertions:

- The direct Settings → Git route renders and marks its navigation entry active.
- Testing the inherited empty agent reports unavailable keys.
- An invalid socket cannot replace saved settings.
- Testing the selected agent finds its key without saving a choice.
- Saving applies the socket immediately; reloading retains it.
- The 390px viewport has no horizontal overflow; 1440px and mobile screenshots
  were visually inspected.
- Leaving Settings discards unsaved edits.
- Clicking the failed run’s **Retry step** completes the same retained run without
  restarting the worker; its resulting commit carries an SSH signature.
- `git verify-commit` verifies that signature against the generated fixture key.
- Clearing the saved socket restores the inherited empty agent.

## Checks and evidence

The focused Git settings, GitService, GitHub authentication, runner environment,
execution profile, dashboard server and PWA suites passed (170 cases in the initial
combined run, followed by the saved-agent runner regression: 4 runner cases).
The two real-agent GitSettings regressions were rerun after final recovery-message
cleanup. Workspace `pnpm build`, `pnpm typecheck`, targeted Biome checks and
`git diff --check` passed.

Local evidence: `/tmp/bobs-factory-git-agent-evidence/fixture.json`,
`browser-checks.json`, `git-settings-desktop.png`, `git-settings-mobile.png` and
`allowed-signers`. Reproducible fixture/browser scripts are committed alongside
this report. Both listeners, disposable agents and the browser session were
stopped after validation; temporary evidence was retained.

The first browser attempt using the collaborative preview timed out twice; its
computer-use fallback had no browser surfaces, so the drive used the repository’s
agent-browser workflow. Exploratory harness runs corrected an assumed “Resume”
button label to the actual **Retry step** action, reloaded the browser after a
fixture restart, and supplied a whitespace value for the automation bridge’s
empty-fill behavior. The final fresh-fixture run completed all assertions.

The connection test lists agent keys; it does not itself sign or prove a particular
key is unlocked. Real Bitwarden/1Password consent dialogs, remote Git authentication
and running child-process environment changes are outside this drive. Production
profiles retain their explicit credential bindings; focused execution tests verify
that the instance setting does not override an explicit execution environment.


## Identity settings consolidation — final PR UI

Validated on 2026-10-15 against `21c22447` plus the consolidation changes. The
served dashboard build was `fba532167d9ec15ad52ea13f`. The T3 collaborative preview
was available for this drive and performed the actual UI interactions.

A fresh embedded mocked F1 worker, repository, generated key and two real local
SSH agents reproduced the failed signing command. The **Identity profiles** page
contained **Host Git identity**, with no separate Git navigation entry. The drive
passed 14 checks: inherited empty-agent diagnosis, invalid-path rejection, testing
without saving, immediate host-agent save and reload persistence, successful retry
of the same retained run, cryptographic verification of its resulting commit,
explicit signing and repository agent selection/testing without host mutation,
disabled testing for an unspecified explicit agent, disposal of unsent profile
edits on navigation, 390px layout without horizontal overflow, and restored host
inheritance after clearing the override.

Focused Git settings, PWA restoration, execution profile and execution environment
suites passed all 77 cases. Build/type checks and targeted Biome checks passed;
commit hooks repeat the required workspace checks. Profile agents remain saved
through the existing execution-profile form; host recovery has its own clearly
labelled save action and does not rewrite accepted profiles or credentials.

Evidence is retained separately at
`/tmp/bobs-factory-git-identity-evidence`: `fixture.json`, `browser-checks.json`,
`allowed-signers` and `signature-verification.txt`. The check receipt links the
visually inspected mobile screenshot saved by T3. The browser fixture script is
updated to the consolidated route and controls for reproducible agent-browser
runs; this validation used T3 directly. The fixture worker and disposable agents
were stopped after validation. Original evidence under
`/tmp/bobs-factory-git-agent-evidence` remains intact.
