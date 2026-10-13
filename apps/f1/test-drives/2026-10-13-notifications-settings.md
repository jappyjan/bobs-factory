# Notifications in Settings

Validated the inline Notifications page and dashboard-wide subscription maintenance
on 2026-10-13. F1 applies because this changes the authenticated dashboard workflow.

The tested worktree starts at `043eea7e540090e97261ae688ca470c6aefeddac`, with
uncommitted implementation changes. Its tracked diff SHA-256 is
`a25471062e8584946c2ebc24fff51a43ec4f895803562bde228f21175932a34c`;
the served web build is `999335a2ef2188c63f9b3d79`. The revision receipt and
complete assertions are in the evidence directory below. No PR was published.

## Executed validation

The embedded F1 EdgeWorker uses a fresh temporary home and Git repository,
`f1AgentHandlers("mock")`, a recording push sender, and controlled browser
notification permission/subscription APIs. It serves the actual built dashboard
and protected Factory API. No real push service or agent inference was used.

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-f1 build

# Start in one terminal; stop this process with SIGTERM after the browser drive.
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=<evidence-directory> \
  node --experimental-strip-types apps/f1/test-drives/assets/notifications-settings.ts

# Run in another terminal, against the isolated fixture on localhost:3647.
F1_EVIDENCE_DIR=<evidence-directory> \
  node apps/f1/test-drives/assets/notifications-settings-browser.mjs
```

The fixture's two signed-out remote-origin API requests returned 401 for config
and push. The headless agent-browser drive passed 23 checks:

- Direct loading/reload, active Settings navigation, inline heading and no header
  Notifications button or dialog.
- Denied/unsupported states and explicit permission request in the Enable click.
- Enable, recording test-send acceptance, local disable, remote disable and removal.
  Remote actions also work through keyboard activation.
- Section/page navigation discards unsent labels; ordinary status refresh preserves
  edits and saved consent. Late errors do not appear in a replacement form.
- An enable request finishing after navigation refreshes device status while
  retaining the replacement form's label.
- Storage events reconcile remote disable/removal, revoked permission and a
  controlled changed server key on Today, without automatic re-enable.
- Failed local disable immediately stops the browser subscription and retains
  deferred cleanup. Reconnect on Today completes that cleanup.
- Controlled access loss unmounts the private form, preserves opt-out bookkeeping
  and does not restore the old label when access returns.
- Desktop (1440px) and narrow-screen (390px) layouts fit long device labels and
  controls without horizontal clipping. Both screenshots were visually inspected.

The five focused suites passed all 82 tests:

```sh
pnpm --filter bobs-factory-edge-worker test:run \
  test/FactoryNotifications.test.ts test/FactoryPwa.test.ts \
  test/FactoryWebClient.test.ts test/FactoryPush.test.ts \
  test/prompt-assembly.routing-context.test.ts
pnpm --filter bobs-factory-edge-worker typecheck
```

The PWA suite covers Notifications route restoration without editable drafts,
rejects nested/query routes, and retains the existing Settings cases. The prompt
suite verifies the complete updated capability prompt. Biome passed on changed
source/fixture files with 17 existing stylesheet warnings. `git diff --check`
passed. The browser session and both fixture listeners were stopped.

## Evidence and limits

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-9d3697a3-1223-4b28-ad0d-d91f0e797e70`.

Records include `notifications-browser-results.json`,
`notifications-protected-access.json`, `notifications-revision.json`,
`notification-sends.json`, command logs, the final accessibility snapshot, and
`notifications-desktop.png` / `notifications-mobile.png`.

Initial validation required building missing workspace dependencies and dashboard
assets. An exploratory synthetic visibility event combined with reconnect caused
access loss; the final drive uses separate storage/reconnect events. A Bun fixture
also logged response-header errors; the final Node fixture completed without those
errors. Neither exploratory failure changed authentication or SSE product code.

Browser push APIs, key-change responses and access-loss responses are controlled;
remote authentication denial uses the real server with injected requests. This
validates form/controller behavior and protected API handling, not a real passkey
ceremony, OS notification display or physical-device background delivery. Visibility
listener behavior shares the tested foreground handler but was not independently
validated through a physical browser background/foreground transition. App-update
restoration is covered by the focused PWA suite rather than an installed binary
update. No production device was contacted, and historical F1 reports are unchanged.
