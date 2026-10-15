# Configure the instance SSH agent in Settings

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
